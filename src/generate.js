import { getContext, getActiveProfileId, getSettings } from './settings.js';
import { extractJsonObject } from './utils.js';
import {
    buildAiSlopPrompt,
    buildCharacterPrompt,
    buildLorebookPrompt,
    buildPersonaPrompt,
    buildRemakePrompt,
} from './prompts.js';

const JSON_SYSTEM_PROMPT = 'Return only valid JSON. No markdown fences. No commentary. No reasoning tags.';
const MACRO_OPEN = '%%{';
const MACRO_CLOSE = '}%%';

function neutralizeStMacros(text) {
    return String(text ?? '').replace(/\{\{([^{}]+)\}\}/g, `${MACRO_OPEN}$1${MACRO_CLOSE}`);
}

function restoreStMacros(value) {
    if (typeof value === 'string') {
        return value.replace(/%%\{([^{}]+)\}%%/g, '{{$1}}');
    }
    if (Array.isArray(value)) return value.map(restoreStMacros);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            out[key] = restoreStMacros(item);
        }
        return out;
    }
    return value;
}

export function creativityToTemperature(level) {
    const n = Number(level);
    const value = Number.isFinite(n) ? n : 45;
    return Math.round((0.35 + (value / 100) * 0.85) * 100) / 100;
}

function snippet(text, max = 280) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value) return '(empty)';
    return value.length > max ? `${value.slice(0, max)}…` : value;
}

function stripReasoning(text) {
    const raw = String(text ?? '');
    const ctx = getContext();
    if (typeof ctx.parseReasoningFromString === 'function') {
        try {
            const parsed = ctx.parseReasoningFromString(raw, { strict: false });
            if (parsed?.content && parsed.content !== raw) {
                return String(parsed.content).trim();
            }
        } catch (_) {
            /* fall through */
        }
    }
    return raw
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .trim();
}

function extractContent(result) {
    if (result == null) throw new Error('Empty response from the connection profile.');
    if (typeof result === 'string') return result;
    if (typeof result.content === 'string' && result.content.trim()) {
        return result.content;
    }
    if (typeof result.reasoning === 'string' && result.reasoning.trim()) {
        return result.reasoning;
    }
    if (typeof result.text === 'string') return result.text;
    if (typeof result.message === 'string') return result.message;
    if (typeof result.data === 'string') return result.data;
    if (Array.isArray(result.choices) && result.choices[0]) {
        const choice = result.choices[0];
        if (typeof choice === 'string') return choice;
        if (choice.message?.content) return choice.message.content;
        if (choice.text) return choice.text;
    }
    return JSON.stringify(result);
}

async function requestViaProfile({ prompt, systemPrompt, tokens, temperature }) {
    const ctx = getContext();
    const profileId = getActiveProfileId();
    if (!profileId || !ctx.ConnectionManagerRequestService?.sendRequest) {
        return null;
    }

    const messages = [
        { role: 'system', content: neutralizeStMacros(systemPrompt || JSON_SYSTEM_PROMPT) },
        { role: 'user', content: neutralizeStMacros(prompt) },
    ];

    const result = await ctx.ConnectionManagerRequestService.sendRequest(
        profileId,
        messages,
        tokens,
        { extractData: true },
        Number.isFinite(temperature) ? { temperature } : {},
    );
    return extractContent(result);
}

async function requestViaGenerateRaw({ prompt, systemPrompt, tokens }) {
    const ctx = getContext();
    if (typeof ctx.generateRaw !== 'function') {
        throw new Error('SillyTavern generation API is unavailable. Update ST or pick a connection profile.');
    }

    // Do not pass jsonSchema. ST only extracts schema JSON for OpenAI-style
    // chat completion; every other backend comes back as "{}".
    const raw = await ctx.generateRaw({
        prompt: neutralizeStMacros(prompt),
        systemPrompt: neutralizeStMacros(systemPrompt || JSON_SYSTEM_PROMPT),
        instructOverride: true,
        quietToLoud: false,
        responseLength: tokens,
    });

    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return JSON.stringify(raw);
    }
    return String(raw ?? '');
}

export async function generateText({ prompt, systemPrompt = JSON_SYSTEM_PROMPT, maxTokens, creativity }) {
    const settings = getSettings();
    const tokens = maxTokens || settings.maxResponseTokens || 3500;
    const temperature = creativityToTemperature(creativity);
    const profileId = getActiveProfileId();

    let text = '';
    let usedProfile = false;

    if (profileId) {
        try {
            text = await requestViaProfile({ prompt, systemPrompt, tokens, temperature });
            usedProfile = Boolean(String(text || '').trim());
        } catch (error) {
            console.warn('[Card Crafter] Connection profile request failed, falling back to generateRaw.', error);
        }
    }

    if (!usedProfile) {
        text = await requestViaGenerateRaw({ prompt, systemPrompt, tokens });
    }

    const cleaned = stripReasoning(text);
    const usable = cleaned.trim() || String(text || '').trim();
    if (!usable) {
        throw new Error('The model returned an empty response. Check that a model is selected and responding.');
    }
    return usable;
}

function parseJsonPayload(text) {
    const parsed = extractJsonObject(text);
    if (!parsed || (typeof parsed === 'object' && !Array.isArray(parsed) && !Object.keys(parsed).length)) {
        throw new Error('Model returned empty JSON.');
    }
    return restoreStMacros(parsed);
}

export async function generateJson({ prompt, systemPrompt, creativity, maxTokens }) {
    const text = await generateText({ prompt, systemPrompt, creativity, maxTokens });
    try {
        return parseJsonPayload(text);
    } catch (error) {
        const reason = error?.message || String(error);
        throw new Error(`${reason} First words: ${snippet(text)}`);
    }
}

export function generateCharacter(options) {
    return generateJson({
        prompt: buildCharacterPrompt(options),
        creativity: options.creativity,
    });
}

export function generateLorebook(options) {
    return generateJson({
        prompt: buildLorebookPrompt(options),
        creativity: options.creativity,
    });
}

export function generatePersona(options) {
    return generateJson({
        prompt: buildPersonaPrompt(options),
        creativity: options.creativity,
        maxTokens: 1800,
    });
}

export async function remakeCharacter(options) {
    const settings = getSettings();
    const tokens = Math.max(Number(settings.maxResponseTokens) || 0, 4000);
    const result = await generateJson({
        prompt: buildRemakePrompt(options),
        creativity: options.creativity,
        maxTokens: tokens,
    });
    const name = String(result?.name || '').trim();
    const description = String(result?.description || '').trim();
    if (!name || !description) {
        throw new Error('Remake came back without a usable name/description. The model probably ran out of tokens — try again with lorebook off, or raise max response tokens.');
    }
    return result;
}

export function gradeCardWithAi(cardText) {
    const settings = getSettings();
    const tokens = Math.max(Number(settings.maxResponseTokens) || 0, 2200);
    return generateJson({
        prompt: buildAiSlopPrompt(cardText),
        creativity: 15,
        maxTokens: tokens,
    });
}
