import { getContext, getActiveProfileId, getSettings } from './settings.js';
import { extractJsonObject } from './utils.js';
import {
    buildAiSlopPrompt,
    buildCharacterPrompt,
    buildLorebookPrompt,
    buildPersonaPrompt,
    buildRemakePrompt,
} from './prompts.js';

function creativityToTemperature(level) {
    const n = Number(level);
    const value = Number.isFinite(n) ? n : 45;
    return Math.round((0.35 + (value / 100) * 0.85) * 100) / 100;
}

export async function generateJson({ prompt, creativity, maxTokens }) {
    const ctx = getContext();
    const settings = getSettings();
    const tokens = maxTokens || settings.maxResponseTokens || 3500;
    const profileId = getActiveProfileId();

    if (profileId && ctx.ConnectionManagerRequestService?.sendRequest) {
        try {
            const result = await ctx.ConnectionManagerRequestService.sendRequest(
                profileId,
                [{ role: 'user', content: prompt }],
                tokens,
            );
            const text = extractContent(result);
            return extractJsonObject(text);
        } catch (error) {
            console.warn('[Card Crafter] Connection profile request failed, falling back to generateRaw.', error);
        }
    }

    if (typeof ctx.generateRaw !== 'function') {
        throw new Error('SillyTavern generation API is unavailable. Update ST or pick a connection profile.');
    }

    const raw = await ctx.generateRaw({
        prompt,
        systemPrompt: 'Return only valid JSON. No markdown. No commentary.',
        instructOverride: true,
        quietToLoud: false,
        responseLength: tokens,
        jsonSchema: { name: 'card_crafter', value: { type: 'object' }, returnInvalid: true },
    });

    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return raw;
    }
    return extractJsonObject(String(raw ?? ''));
}

function extractContent(result) {
    if (!result) throw new Error('Empty response from the connection profile.');
    if (typeof result === 'string') return result;
    if (typeof result.content === 'string') return result.content;
    if (typeof result.text === 'string') return result.text;
    if (typeof result.message === 'string') return result.message;
    if (result.data && typeof result.data === 'string') return result.data;
    if (Array.isArray(result.choices) && result.choices[0]) {
        const choice = result.choices[0];
        if (typeof choice === 'string') return choice;
        if (choice.message?.content) return choice.message.content;
        if (choice.text) return choice.text;
    }
    return JSON.stringify(result);
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

export function remakeCharacter(options) {
    return generateJson({
        prompt: buildRemakePrompt(options),
        creativity: options.creativity,
    });
}

export function gradeCardWithAi(cardText) {
    return generateJson({
        prompt: buildAiSlopPrompt(cardText),
        creativity: 15,
        maxTokens: 900,
    });
}

export { creativityToTemperature };
