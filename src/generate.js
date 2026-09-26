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

export function isAbortError(error) {
    return Boolean(
        error
        && (error.name === 'AbortError' || error.code === 20 || /aborted|abort/i.test(String(error.message || ''))),
    );
}

function snippet(text, max = 280) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value) return '(empty)';
    return value.length > max ? `${value.slice(0, max)}…` : value;
}

function throwIfAborted(signal) {
    if (signal?.aborted) {
        const error = new DOMException('Generation stopped.', 'AbortError');
        throw error;
    }
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

function buildMessages(prompt, systemPrompt) {
    return [
        { role: 'system', content: neutralizeStMacros(systemPrompt || JSON_SYSTEM_PROMPT) },
        { role: 'user', content: neutralizeStMacros(prompt) },
    ];
}

async function consumeStream(result, { signal, onChunk } = {}) {
    if (typeof result === 'function') {
        let text = '';
        let reasoning = '';
        for await (const chunk of result()) {
            throwIfAborted(signal);
            if (typeof chunk === 'string') {
                text = chunk;
            } else {
                text = chunk?.text ?? text;
                reasoning = chunk?.state?.reasoning ?? reasoning;
            }
            onChunk?.({ text, reasoning, streaming: true });
        }
        return reasoning && !String(text || '').trim() ? reasoning : text;
    }

    const text = extractContent(result);
    const reasoning = typeof result?.reasoning === 'string' ? result.reasoning : '';
    onChunk?.({ text, reasoning, streaming: false });
    return text;
}

async function requestViaProfile({ prompt, systemPrompt, tokens, temperature, signal, onChunk }) {
    const ctx = getContext();
    const profileId = getActiveProfileId();
    if (!profileId || !ctx.ConnectionManagerRequestService?.sendRequest) {
        return null;
    }

    const result = await ctx.ConnectionManagerRequestService.sendRequest(
        profileId,
        buildMessages(prompt, systemPrompt),
        tokens,
        { extractData: true, stream: true, signal },
        Number.isFinite(temperature) ? { temperature } : {},
    );
    return consumeStream(result, { signal, onChunk });
}

async function requestViaCurrentApi({ prompt, systemPrompt, tokens, temperature, signal, onChunk }) {
    const ctx = getContext();
    const api = ctx.mainApi;
    const messages = buildMessages(prompt, systemPrompt);

    if (api === 'openai' && ctx.ChatCompletionService?.processRequest) {
        const result = await ctx.ChatCompletionService.processRequest({
            stream: true,
            messages,
            max_tokens: tokens,
            model: ctx.getChatCompletionModel?.() || undefined,
            chat_completion_source: ctx.chatCompletionSettings?.chat_completion_source,
            temperature,
            custom_url: ctx.chatCompletionSettings?.custom_url,
            reverse_proxy: ctx.chatCompletionSettings?.reverse_proxy,
            proxy_password: ctx.chatCompletionSettings?.proxy_password,
        }, {}, true, signal);
        return consumeStream(result, { signal, onChunk });
    }

    if (api === 'textgenerationwebui' && ctx.TextCompletionService?.processRequest) {
        const instructEnabled = Boolean(ctx.powerUserSettings?.instruct?.enabled);
        const result = await ctx.TextCompletionService.processRequest({
            stream: true,
            prompt: messages,
            max_tokens: tokens,
            model: ctx.textCompletionSettings?.model,
            api_type: ctx.textCompletionSettings?.type,
            api_server: typeof ctx.getTextGenServer === 'function' ? ctx.getTextGenServer() : undefined,
            temperature,
        }, {
            instructName: instructEnabled ? ctx.powerUserSettings?.instruct?.preset : undefined,
        }, true, signal);
        return consumeStream(result, { signal, onChunk });
    }

    return null;
}

async function requestViaGenerateRaw({ prompt, systemPrompt, tokens, signal, onChunk }) {
    const ctx = getContext();
    if (typeof ctx.generateRaw !== 'function') {
        throw new Error('SillyTavern generation API is unavailable. Update ST or pick a connection profile.');
    }

    throwIfAborted(signal);
    onChunk?.({ text: '', reasoning: '', streaming: false });
    const raw = await ctx.generateRaw({
        prompt: neutralizeStMacros(prompt),
        systemPrompt: neutralizeStMacros(systemPrompt || JSON_SYSTEM_PROMPT),
        instructOverride: true,
        quietToLoud: false,
        responseLength: tokens,
    });
    throwIfAborted(signal);

    const text = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? JSON.stringify(raw)
        : String(raw ?? '');
    onChunk?.({ text, reasoning: '', streaming: false });
    return text;
}

export async function generateText({
    prompt,
    systemPrompt = JSON_SYSTEM_PROMPT,
    maxTokens,
    creativity,
    signal,
    onChunk,
} = {}) {
    const settings = getSettings();
    const tokens = maxTokens || settings.maxResponseTokens || 3500;
    const temperature = creativityToTemperature(creativity);
    const profileId = getActiveProfileId();
    let text = '';
    let streamed = false;

    if (profileId) {
        try {
            text = await requestViaProfile({ prompt, systemPrompt, tokens, temperature, signal, onChunk });
            streamed = text != null;
        } catch (error) {
            if (isAbortError(error) || signal?.aborted) throw error;
            console.warn('[Card Crafter] Connection profile stream failed, trying the current API.', error);
        }
    }

    if (!streamed) {
        try {
            const current = await requestViaCurrentApi({ prompt, systemPrompt, tokens, temperature, signal, onChunk });
            if (current != null) {
                text = current;
                streamed = true;
            }
        } catch (error) {
            if (isAbortError(error) || signal?.aborted) throw error;
            console.warn('[Card Crafter] Current API stream failed, falling back to generateRaw.', error);
        }
    }

    if (!streamed) {
        onChunk?.({ text: '', reasoning: '', streaming: false, fallback: true });
        text = await requestViaGenerateRaw({ prompt, systemPrompt, tokens, signal, onChunk });
    }

    throwIfAborted(signal);
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

export async function generateJson({ prompt, systemPrompt, creativity, maxTokens, signal, onChunk } = {}) {
    const text = await generateText({ prompt, systemPrompt, creativity, maxTokens, signal, onChunk });
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
        signal: options.signal,
        onChunk: options.onChunk,
    });
}

export function generateLorebook(options) {
    return generateJson({
        prompt: buildLorebookPrompt(options),
        creativity: options.creativity,
        signal: options.signal,
        onChunk: options.onChunk,
    });
}

export function generatePersona(options) {
    return generateJson({
        prompt: buildPersonaPrompt(options),
        creativity: options.creativity,
        maxTokens: 1800,
        signal: options.signal,
        onChunk: options.onChunk,
    });
}

export async function remakeCharacter(options) {
    const settings = getSettings();
    const tokens = Math.max(Number(settings.maxResponseTokens) || 0, 4000);
    const result = await generateJson({
        prompt: buildRemakePrompt(options),
        creativity: options.creativity,
        maxTokens: tokens,
        signal: options.signal,
        onChunk: options.onChunk,
    });
    const name = String(result?.name || '').trim();
    const description = String(result?.description || '').trim();
    if (!name || !description) {
        throw new Error('Remake came back without a usable name/description. The model probably ran out of tokens — try again with lorebook off, or raise max response tokens.');
    }
    return result;
}

export function gradeCardWithAi(cardText, options = {}) {
    const settings = getSettings();
    const tokens = Math.max(Number(settings.maxResponseTokens) || 0, 2200);
    return generateJson({
        prompt: buildAiSlopPrompt(cardText),
        creativity: 15,
        maxTokens: tokens,
        signal: options.signal,
        onChunk: options.onChunk,
    });
}
