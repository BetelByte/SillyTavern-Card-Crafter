import { getContext, getSettings } from './settings.js';
import { uniqueStrings, sanitizeFileName, toast } from './utils.js';
import { normalizeCard } from './slop.js';

export function toCharacterPayload(raw, extras = {}) {
    const data = normalizeCard(raw);
    const settings = getSettings();
    const tags = Array.isArray(data.tags)
        ? data.tags
        : String(data.tags || '').split(',').map((t) => t.trim()).filter(Boolean);

    return {
        name: String(data.name || extras.name || 'Unnamed').trim(),
        description: data.description || '',
        personality: data.personality || '',
        scenario: data.scenario || '',
        first_mes: data.first_mes || '',
        mes_example: data.mes_example || '',
        creator_notes: data.creator_notes || data.creatorcomment || extras.creator_notes || '',
        system_prompt: data.system_prompt || '',
        post_history_instructions: data.post_history_instructions || '',
        tags,
        creator: data.creator || settings.creatorName || extras.creator || '',
        character_version: data.character_version || '1.0',
        alternate_greetings: Array.isArray(data.alternate_greetings) ? data.alternate_greetings.filter(Boolean) : [],
        talkativeness: Number.isFinite(Number(data.talkativeness)) ? Number(data.talkativeness) : 0.5,
        depth_prompt: data.depth_prompt || data.extensions?.depth_prompt?.prompt || '',
        lorebook: Array.isArray(data.lorebook) ? data.lorebook : (data.character_book?.entries || []),
    };
}

export function toLorebookPayload(raw, fallbackName = 'Card Crafter Lorebook') {
    if (Array.isArray(raw)) {
        return { name: fallbackName, description: '', entries: raw };
    }
    if (raw?.entries && typeof raw.entries === 'object' && !Array.isArray(raw.entries)) {
        return {
            name: raw.name || fallbackName,
            description: raw.description || '',
            entries: Object.values(raw.entries),
        };
    }
    return {
        name: raw?.name || fallbackName,
        description: raw?.description || '',
        entries: Array.isArray(raw?.entries) ? raw.entries : [],
    };
}

export function toPersonaPayload(raw) {
    const data = normalizeCard(raw);
    const description = [data.description, data.personality].filter(Boolean).join('\n\n');
    return {
        name: String(data.name || 'Unnamed Persona').trim(),
        title: data.title || '',
        description,
        personality: data.personality || '',
    };
}

export function buildCharacterBook(lorebook, name = '') {
    const book = toLorebookPayload(lorebook, name || 'Lorebook');
    if (!book.entries.length) return undefined;
    return {
        name: book.name || name || 'Lorebook',
        description: book.description || '',
        scan_depth: 4,
        token_budget: 512,
        recursive_scanning: false,
        extensions: {},
        entries: book.entries.map((entry, index) => {
            const keys = uniqueStrings(entry.keys || entry.key || []);
            return {
                id: Number.isInteger(entry.uid) ? entry.uid : index,
                keys,
                secondary_keys: uniqueStrings(entry.secondary_keys || entry.keysecondary || []),
                comment: entry.comment || entry.name || `Entry ${index}`,
                content: entry.content || '',
                constant: Boolean(entry.constant),
                selective: true,
                insertion_order: Number.isFinite(Number(entry.insertion_order ?? entry.order)) ? Number(entry.insertion_order ?? entry.order) : 100,
                enabled: entry.enabled !== false && entry.disable !== true,
                position: 'before_char',
                use_regex: false,
                extensions: {},
            };
        }),
    };
}

export function buildCharacterCardJson(payload) {
    const characterBook = payload.character_book || buildCharacterBook(payload.lorebook, `${payload.name || 'Character'} Lore`);
    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: payload.name,
            description: payload.description,
            personality: payload.personality,
            scenario: payload.scenario,
            first_mes: payload.first_mes,
            mes_example: payload.mes_example,
            creator_notes: payload.creator_notes,
            system_prompt: payload.system_prompt,
            post_history_instructions: payload.post_history_instructions,
            tags: payload.tags,
            creator: payload.creator,
            character_version: payload.character_version,
            alternate_greetings: payload.alternate_greetings,
            extensions: {
                talkativeness: payload.talkativeness,
                fav: false,
                world: payload.world || '',
                depth_prompt: {
                    prompt: payload.depth_prompt || '',
                    depth: 4,
                    role: 'system',
                },
            },
            character_book: characterBook,
        },
    };
}

export function buildWorldInfoFile(lorebook) {
    const book = toLorebookPayload(lorebook);
    const entries = {};
    book.entries.forEach((entry, index) => {
        const uid = Number.isInteger(entry.uid) ? entry.uid : index;
        const keys = uniqueStrings(entry.keys || entry.key || []);
        entries[uid] = {
            uid,
            key: keys,
            keysecondary: uniqueStrings(entry.secondary_keys || entry.keysecondary || []),
            comment: entry.comment || entry.name || `Entry ${uid}`,
            content: entry.content || '',
            constant: Boolean(entry.constant),
            vectorized: false,
            selective: true,
            selectiveLogic: 0,
            addMemo: Boolean(entry.comment),
            order: Number.isFinite(Number(entry.insertion_order ?? entry.order)) ? Number(entry.insertion_order ?? entry.order) : 100,
            position: 0,
            disable: entry.enabled === false || entry.disable === true,
            ignoreBudget: false,
            excludeRecursion: false,
            preventRecursion: false,
            matchPersonaDescription: false,
            matchCharacterDescription: false,
            matchCharacterPersonality: false,
            matchCharacterDepthPrompt: false,
            matchScenario: false,
            matchCreatorNotes: false,
            delayUntilRecursion: 0,
            probability: 100,
            useProbability: true,
            depth: 4,
            outletName: '',
            group: entry.group || '',
            groupOverride: false,
            groupWeight: 100,
            scanDepth: null,
            caseSensitive: null,
            matchWholeWords: null,
            useGroupScoring: null,
            automationId: '',
            role: 0,
            sticky: null,
            cooldown: null,
            delay: null,
            triggers: [],
        };
    });
    return {
        name: book.name,
        description: book.description,
        entries,
    };
}

export async function importCharacterToSillyTavern(payload, { worldName = '' } = {}) {
    const ctx = getContext();
    const formData = new FormData();
    formData.append('ch_name', payload.name);
    formData.append('description', payload.description || '');
    formData.append('personality', payload.personality || '');
    formData.append('scenario', payload.scenario || '');
    formData.append('first_mes', payload.first_mes || '');
    formData.append('mes_example', payload.mes_example || '');
    formData.append('creator_notes', payload.creator_notes || '');
    formData.append('system_prompt', payload.system_prompt || '');
    formData.append('post_history_instructions', payload.post_history_instructions || '');
    formData.append('tags', Array.isArray(payload.tags) ? payload.tags.join(', ') : String(payload.tags || ''));
    formData.append('creator', payload.creator || '');
    formData.append('character_version', payload.character_version || '1.0');
    formData.append('talkativeness', String(payload.talkativeness ?? 0.5));
    formData.append('fav', 'false');
    formData.append('world', worldName || '');
    formData.append('depth_prompt_prompt', payload.depth_prompt || '');
    formData.append('depth_prompt_depth', '4');
    formData.append('depth_prompt_role', 'system');
    for (const greeting of payload.alternate_greetings || []) {
        formData.append('alternate_greetings', greeting);
    }
    formData.append('extensions', JSON.stringify({
        talkativeness: payload.talkativeness ?? 0.5,
        fav: false,
        world: worldName || '',
        depth_prompt: {
            prompt: payload.depth_prompt || '',
            depth: 4,
            role: 'system',
        },
    }));

    const response = await fetch('/api/characters/create', {
        method: 'POST',
        headers: ctx.getRequestHeaders({ omitContentType: true }),
        body: formData,
        cache: 'no-cache',
    });

    if (!response.ok) {
        throw new Error(`Character create failed (${response.status}).`);
    }

    const avatarId = (await response.text()).trim();
    if (typeof ctx.getCharacters === 'function') {
        await ctx.getCharacters();
    }
    return avatarId;
}

export async function importLorebookToSillyTavern(lorebook, preferredName) {
    const ctx = getContext();
    const book = toLorebookPayload(lorebook, preferredName);
    if (!book.entries.length) {
        throw new Error('Lorebook has no entries to import.');
    }

    const file = buildWorldInfoFile(book);
    let worldName = sanitizeFileName(preferredName || book.name || 'Card Crafter Lorebook');
    const existing = typeof ctx.getWorldInfoNames === 'function' ? ctx.getWorldInfoNames() : [];
    if (existing.includes(worldName)) {
        worldName = `${worldName} ${Date.now().toString().slice(-4)}`;
    }

    await ctx.saveWorldInfo(worldName, { entries: file.entries }, true);
    if (typeof ctx.updateWorldInfoList === 'function') {
        await ctx.updateWorldInfoList();
    }
    return worldName;
}

export async function importPersonaToSillyTavern(payload) {
    const ctx = getContext();
    const avatarId = `${Date.now()}-${sanitizeFileName(payload.name).replace(/[^a-zA-Z0-9]/g, '') || 'persona'}.png`;
    const powerUser = ctx.powerUserSettings;
    if (!powerUser.personas) powerUser.personas = {};
    if (!powerUser.persona_descriptions) powerUser.persona_descriptions = {};

    powerUser.personas[avatarId] = payload.name;
    powerUser.persona_descriptions[avatarId] = {
        description: payload.description || '',
        position: 0,
        depth: 2,
        role: 0,
        lorebook: '',
        title: payload.title || '',
    };
    ctx.saveSettingsDebounced();

    try {
        const avatarRes = await fetch('/img/ai4.png');
        const blob = await avatarRes.blob();
        const file = new File([blob], 'avatar.png', { type: 'image/png' });
        const formData = new FormData();
        formData.append('avatar', file);
        formData.append('overwrite_name', avatarId);
        await fetch('/api/avatars/upload', {
            method: 'POST',
            headers: ctx.getRequestHeaders({ omitContentType: true }),
            cache: 'no-cache',
            body: formData,
        });
    } catch (error) {
        console.warn('[Card Crafter] Persona avatar upload failed; persona was still saved.', error);
    }

    return avatarId;
}

export function parseImportedCard(raw) {
    if (!raw) throw new Error('Empty card.');
    if (typeof raw === 'string') {
        const parsed = JSON.parse(raw);
        return normalizeCard(parsed);
    }
    return normalizeCard(raw);
}

export function describeImport(kind, name) {
    toast('success', `${kind} “${name}” imported into SillyTavern.`);
}
