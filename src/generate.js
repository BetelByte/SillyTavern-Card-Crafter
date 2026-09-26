import { logWarn } from './error-log.js';
import { getContext, getActiveProfileId, getSettings } from './settings.js';
import { creativityToTemperature, extractJsonObject } from './utils.js';
import { CHARACTER_FIELD_STEPS, PERSONA_FIELD_STEPS, getDetailPreset } from './constants.js';
import {
    buildAiSlopPrompt,
    buildFieldPrompt,
    buildLorebookPrompt,
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

export { creativityToTemperature };

function withSampling(temperature, fn) {
    const ctx = getContext();
    const restores = [];
    const patch = (object, key, value) => {
        if (!object || typeof object !== 'object' || !(key in object)) return;
        const previous = object[key];
        object[key] = value;
        restores.push(() => {
            object[key] = previous;
        });
    };

    if (Number.isFinite(temperature)) {
        patch(ctx.chatCompletionSettings, 'temp_openai', temperature);
        patch(ctx.textCompletionSettings, 'temp', temperature);
    }

    const run = Promise.resolve().then(fn);
    return run.finally(() => {
        while (restores.length) restores.pop()();
    });
}

function samplingOverride(temperature) {
    if (!Number.isFinite(temperature)) return {};
    return {
        temperature,
        temp: temperature,
        temp_openai: temperature,
    };
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

function resolveMaxTokens(override, floor = 0) {
    if (override === 0 || override === 'unlimited') return 0;
    if (Number.isFinite(Number(override)) && Number(override) > 0) {
        return Math.max(Math.round(Number(override)), Number(floor) || 0);
    }
    const setting = Number(getSettings().maxResponseTokens);
    if (!Number.isFinite(setting) || setting <= 0) return 0;
    return Math.max(Math.round(setting), Number(floor) || 0);
}

function resolveDetail(detail) {
    return getDetailPreset(detail || getSettings().defaultDetail);
}

function flattenCardBrief(card) {
    if (!card || typeof card !== 'object') return '';
    return JSON.stringify({
        name: card.name || '',
        description: card.description || '',
        personality: card.personality || '',
        scenario: card.scenario || '',
        first_mes: card.first_mes || '',
        creator_notes: card.creator_notes || '',
        tags: card.tags || [],
    }, null, 2);
}

function normalizeLoreEntries(raw, fallbackName = 'Card Crafter Lorebook') {
    const source = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : Array.isArray(raw?.lorebook) ? raw.lorebook : [];
    const entries = source
        .map((entry, index) => {
            if (!entry || typeof entry !== 'object') return null;
            const keys = Array.isArray(entry.keys) ? entry.keys : Array.isArray(entry.key) ? entry.key : [];
            const content = String(entry.content || '').trim();
            if (!content) return null;
            return {
                comment: String(entry.comment || entry.name || `Entry ${index + 1}`).trim() || `Entry ${index + 1}`,
                keys: keys.map((key) => String(key || '').trim()).filter(Boolean),
                content,
                constant: Boolean(entry.constant),
                insertion_order: Number.isFinite(Number(entry.insertion_order ?? entry.order)) ? Number(entry.insertion_order ?? entry.order) : 100 + index,
            };
        })
        .filter(Boolean);
    return {
        name: String(raw?.name || fallbackName).trim() || fallbackName,
        description: String(raw?.description || '').trim(),
        entries,
    };
}

function fieldTokenBudget(field, preset) {
    if (field === 'name' || field === 'title') return 200;
    if (field === 'tags' || field === 'extras') return 700;
    if (field === 'alternate_greetings') return 1400;
    if (field === 'mes_example') return 1200;
    if (preset?.id === 'sketch') return 700;
    if (preset?.id === 'masterpiece') return 1800;
    if (preset?.id === 'rich') return 1400;
    return 1100;
}

function extractFieldValue(parsed, field) {
    if (!parsed || typeof parsed !== 'object') return '';
    if (field === 'extras') {
        return {
            system_prompt: String(parsed.system_prompt ?? ''),
            post_history_instructions: String(parsed.post_history_instructions ?? ''),
            creator_notes: String(parsed.creator_notes ?? ''),
            tags: Array.isArray(parsed.tags) ? parsed.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [],
            creator: String(parsed.creator ?? ''),
            character_version: String(parsed.character_version || '1.0'),
            talkativeness: Number.isFinite(Number(parsed.talkativeness)) ? Number(parsed.talkativeness) : 0.5,
            depth_prompt: String(parsed.depth_prompt ?? ''),
        };
    }
    if (field === 'alternate_greetings' || field === 'tags') {
        const list = Array.isArray(parsed[field])
            ? parsed[field]
            : Array.isArray(parsed.value)
                ? parsed.value
                : typeof parsed[field] === 'string'
                    ? [parsed[field]]
                    : [];
        return list.map((item) => String(item || '').trim()).filter(Boolean);
    }
    const value = parsed[field] ?? parsed.value ?? parsed.text ?? parsed.content ?? '';
    return typeof value === 'string' ? value.trim() : String(value || '').trim();
}

function applyField(draft, field, value) {
    if (field === 'extras' && value && typeof value === 'object') {
        return { ...draft, ...value };
    }
    return { ...draft, [field]: value };
}

function announceStep(onChunk, { step, total, label, text = '', streaming = false } = {}) {
    onChunk?.({
        text,
        reasoning: `Step ${step}/${total}: ${label}`,
        streaming,
        step,
        total,
        label,
    });
}

function keepStep(onChunk, stepInfo) {
    if (typeof onChunk !== 'function') return undefined;
    return (chunk = {}) => {
        onChunk({
            ...chunk,
            step: chunk.step || stepInfo.step,
            total: chunk.total || stepInfo.total,
            label: chunk.label || stepInfo.label,
            reasoning: chunk.reasoning || `Step ${stepInfo.step}/${stepInfo.total}: ${stepInfo.label}`,
        });
    };
}

async function generateField({ field, draft, options, mode, stepInfo }) {
    const preset = resolveDetail(options.detail);
    const parsed = await generateJson({
        prompt: buildFieldPrompt({
            field,
            concept: options.concept || '',
            extra: options.extra || '',
            critique: options.critique || '',
            sourceCard: options.cardText || options.sourceCard || '',
            draft,
            creativity: options.creativity,
            detail: preset,
            mode,
        }),
        creativity: options.creativity,
        maxTokens: fieldTokenBudget(field, preset),
        signal: options.signal,
        onChunk: keepStep(options.onChunk, stepInfo),
    });
    return extractFieldValue(parsed, field);
}

async function runFieldPipeline({ steps, options, mode, require = [] }) {
    let draft = {};
    const total = steps.length + (options.includeLorebook ? 1 : 0);
    for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        const stepInfo = { step: index + 1, total, label: step.label };
        announceStep(options.onChunk, stepInfo);
        const value = await generateField({ field: step.id, draft, options, mode, stepInfo });
        if (require.includes(step.id) && !(typeof value === 'string' ? value.trim() : value)) {
            throw new Error(`${step.label} came back empty. Stopped before later fields.`);
        }
        draft = applyField(draft, step.id, value);
        announceStep(options.onChunk, {
            step: index + 1,
            total,
            label: `${step.label} done`,
            text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        });
    }
    return { draft, total };
}

async function attachLorebook(card, options = {}) {
    const {
        concept = '',
        extra = '',
        critique = '',
        creativity,
        detail,
        signal,
        onChunk,
        cardText = '',
        mode = 'generate',
        label = 'Drafting lorebook…',
    } = options;
    const preset = resolveDetail(detail);
    const stepInfo = {
        step: options.step || 1,
        total: options.total || 1,
        label: label.replace(/^Step \d+\/\d+:\s*/, '') || 'Lorebook',
    };
    onChunk?.({ text: '', reasoning: label, streaming: false, ...stepInfo, label: stepInfo.label });
    const book = await generateJson({
        prompt: buildLorebookPrompt({
            concept: concept || card?.name || '',
            creativity,
            extra,
            critique,
            detail: preset,
            card,
            sourceCard: cardText,
            mode,
        }),
        creativity,
        maxTokens: preset.loreTokens || 2800,
        signal,
        onChunk: keepStep(onChunk, stepInfo),
    });
    const normalized = normalizeLoreEntries(book, `${card?.name || 'Character'} Lore`);
    if (!normalized.entries.length) {
        throw new Error('Lorebook pass came back empty. Try again, or raise max response tokens.');
    }
    return {
        ...card,
        lorebook: normalized.entries,
        lorebook_name: normalized.name,
        lorebook_description: normalized.description,
    };
}

function withTokenBudget(payload, tokens) {
    if (!tokens) return payload;
    return { ...payload, max_tokens: tokens };
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
        tokens || undefined,
        { extractData: true, stream: true, signal },
        samplingOverride(temperature),
    );
    return consumeStream(result, { signal, onChunk });
}

async function requestViaCurrentApi({ prompt, systemPrompt, tokens, temperature, signal, onChunk }) {
    const ctx = getContext();
    const api = ctx.mainApi;
    const messages = buildMessages(prompt, systemPrompt);

    if (api === 'openai' && ctx.ChatCompletionService?.processRequest) {
        const result = await ctx.ChatCompletionService.processRequest(withTokenBudget({
            stream: true,
            messages,
            model: ctx.getChatCompletionModel?.() || undefined,
            chat_completion_source: ctx.chatCompletionSettings?.chat_completion_source,
            custom_url: ctx.chatCompletionSettings?.custom_url,
            reverse_proxy: ctx.chatCompletionSettings?.reverse_proxy,
            proxy_password: ctx.chatCompletionSettings?.proxy_password,
            ...samplingOverride(temperature),
        }, tokens), {}, true, signal);
        return consumeStream(result, { signal, onChunk });
    }

    if (api === 'textgenerationwebui' && ctx.TextCompletionService?.processRequest) {
        const instructEnabled = Boolean(ctx.powerUserSettings?.instruct?.enabled);
        const result = await ctx.TextCompletionService.processRequest(withTokenBudget({
            stream: true,
            prompt: messages,
            model: ctx.textCompletionSettings?.model,
            api_type: ctx.textCompletionSettings?.type,
            api_server: typeof ctx.getTextGenServer === 'function' ? ctx.getTextGenServer() : undefined,
            ...samplingOverride(temperature),
        }, tokens), {
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
        ...(tokens ? { responseLength: tokens } : {}),
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
    tokenFloor = 0,
    creativity,
    signal,
    onChunk,
} = {}) {
    const tokens = resolveMaxTokens(maxTokens, tokenFloor);
    const temperature = creativityToTemperature(creativity);
    const profileId = getActiveProfileId();

    return withSampling(temperature, async () => {
        let text = '';
        let streamed = false;

        if (profileId) {
            try {
                text = await requestViaProfile({ prompt, systemPrompt, tokens, temperature, signal, onChunk });
                streamed = text != null;
            } catch (error) {
                if (isAbortError(error) || signal?.aborted) throw error;
                logWarn(error, { source: 'generate-profile', extra: { fallback: 'current-api', temperature } });
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
                logWarn(error, { source: 'generate-current-api', extra: { fallback: 'generateRaw', temperature } });
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
    });
}

function parseJsonPayload(text) {
    const parsed = extractJsonObject(text);
    if (!parsed || (typeof parsed === 'object' && !Array.isArray(parsed) && !Object.keys(parsed).length)) {
        throw new Error('Model returned empty JSON.');
    }
    return restoreStMacros(parsed);
}

export async function generateJson({ prompt, systemPrompt, creativity, maxTokens, tokenFloor, signal, onChunk } = {}) {
    const text = await generateText({ prompt, systemPrompt, creativity, maxTokens, tokenFloor, signal, onChunk });
    try {
        return parseJsonPayload(text);
    } catch (error) {
        const reason = error?.message || String(error);
        throw new Error(`${reason} First words: ${snippet(text)}`);
    }
}

export async function generateCharacter(options) {
    const { draft, total } = await runFieldPipeline({
        steps: CHARACTER_FIELD_STEPS,
        options: { ...options, mode: 'generate' },
        mode: 'generate',
        require: ['name', 'description'],
    });
    if (!options.includeLorebook) return draft;
    announceStep(options.onChunk, {
        step: total,
        total,
        label: 'Lorebook',
    });
    return attachLorebook(draft, {
        ...options,
        mode: 'generate',
        step: total,
        total,
        label: `Step ${total}/${total}: Lorebook`,
    });
}

export function generateLorebook(options) {
    const preset = resolveDetail(options.detail);
    announceStep(options.onChunk, { step: 1, total: 1, label: 'Lorebook' });
    return generateJson({
        prompt: buildLorebookPrompt({ ...options, detail: preset, mode: 'generate' }),
        creativity: options.creativity,
        maxTokens: preset.loreTokens || 2800,
        signal: options.signal,
        onChunk: options.onChunk,
    });
}

export async function generatePersona(options) {
    const { draft } = await runFieldPipeline({
        steps: PERSONA_FIELD_STEPS,
        options: { ...options, includeLorebook: false },
        mode: 'generate',
        require: ['name', 'description'],
    });
    return draft;
}

export async function remakeCharacter(options) {
    const { draft, total } = await runFieldPipeline({
        steps: CHARACTER_FIELD_STEPS,
        options: { ...options, mode: 'remake' },
        mode: 'remake',
        require: ['name', 'description'],
    });
    if (!options.includeLorebook) return draft;
    announceStep(options.onChunk, {
        step: total,
        total,
        label: 'Lorebook',
    });
    return attachLorebook(draft, {
        ...options,
        concept: options.concept || draft.name || '',
        mode: 'remake',
        step: total,
        total,
        label: `Step ${total}/${total}: Lorebook`,
    });
}

export function gradeCardWithAi(cardText, options = {}) {
    return generateJson({
        prompt: buildAiSlopPrompt(cardText),
        creativity: 15,
        signal: options.signal,
        onChunk: options.onChunk,
    });
}
