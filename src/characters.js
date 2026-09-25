import { getContext } from './settings.js';

export function listLibraryCharacters() {
    const ctx = getContext();
    const characters = Array.isArray(ctx.characters) ? ctx.characters : [];
    return characters
        .map((character, index) => ({
            index,
            avatar: character?.avatar || '',
            name: String(character?.name || 'Unnamed').trim() || 'Unnamed',
            shallow: Boolean(character?.shallow),
        }))
        .filter((item) => item.avatar)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function getCurrentCharacterRef() {
    const ctx = getContext();
    const id = ctx.characterId;
    if (id === undefined || id === null || id === '') return null;
    const character = ctx.characters?.[id];
    if (!character?.avatar) return null;
    return {
        index: Number(id),
        avatar: character.avatar,
        name: character.name || 'Current character',
    };
}

export async function loadLibraryCharacter(avatar) {
    const ctx = getContext();
    const characters = Array.isArray(ctx.characters) ? ctx.characters : [];
    const index = characters.findIndex((character) => character?.avatar === avatar);
    if (index === -1) {
        throw new Error('That character is not in your SillyTavern library.');
    }

    if (characters[index]?.shallow && typeof ctx.unshallowCharacter === 'function') {
        await ctx.unshallowCharacter(index);
    } else if (characters[index]?.shallow && typeof ctx.getOneCharacter === 'function') {
        await ctx.getOneCharacter(avatar);
    }

    const character = ctx.characters?.[index];
    if (!character) {
        throw new Error('Could not load that character.');
    }
    return characterToCard(character);
}

export function characterToCard(character) {
    const data = character?.data && typeof character.data === 'object' ? character.data : {};
    const tags = Array.isArray(data.tags)
        ? data.tags
        : Array.isArray(character.tags)
            ? character.tags
            : String(character.tags || data.tags || '')
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean);

    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        name: character.name || data.name || '',
        description: character.description || data.description || '',
        personality: character.personality || data.personality || '',
        scenario: character.scenario || data.scenario || '',
        first_mes: character.first_mes || data.first_mes || '',
        mes_example: character.mes_example || data.mes_example || '',
        creatorcomment: character.creatorcomment || data.creator_notes || '',
        tags,
        talkativeness: character.talkativeness ?? data.extensions?.talkativeness ?? 0.5,
        avatar: character.avatar || '',
        data: {
            name: data.name || character.name || '',
            description: data.description || character.description || '',
            personality: data.personality || character.personality || '',
            scenario: data.scenario || character.scenario || '',
            first_mes: data.first_mes || character.first_mes || '',
            mes_example: data.mes_example || character.mes_example || '',
            creator_notes: data.creator_notes || character.creatorcomment || '',
            system_prompt: data.system_prompt || '',
            post_history_instructions: data.post_history_instructions || '',
            tags,
            creator: data.creator || '',
            character_version: data.character_version || '',
            alternate_greetings: Array.isArray(data.alternate_greetings) ? data.alternate_greetings : [],
            character_book: data.character_book,
            extensions: data.extensions || {},
        },
    };
}

export function characterOptionLabel(item, currentAvatar) {
    return `${item.name}${item.avatar === currentAvatar ? ' (current)' : ''}`;
}
