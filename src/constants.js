export const EXTENSION_NAME = 'SillyTavern-Card-Crafter';
export const MODULE_NAME = 'cardCrafter';
export const VERSION = '1.4.0';
export const DISPLAY_NAME = 'Card Crafter';

export const TABS = [
    { id: 'generate', label: 'Generate', icon: 'fa-wand-magic-sparkles' },
    { id: 'analyze', label: 'Analyze', icon: 'fa-gauge-high' },
    { id: 'remediate', label: 'Remake', icon: 'fa-screwdriver-wrench' },
    { id: 'settings', label: 'Settings', icon: 'fa-gear' },
];

export const GENERATION_TYPES = [
    { id: 'character', label: 'Character', hint: 'A full V2 character card' },
    { id: 'lorebook', label: 'Lorebook', hint: 'World info entries for a setting' },
    { id: 'persona', label: 'Persona', hint: 'A {{user}} persona, not a bot' },
];

export const DETAIL_PRESETS = [
    {
        id: 'sketch',
        label: 'Sketch',
        hint: 'Cheap and short. Good for simple concepts.',
        descriptionWords: '50-110',
        personalityWords: '40-80',
        scenarioWords: '25-60',
        greetingWords: '40-90',
        exampleTurns: '1-2',
        altGreetings: '0-1',
        loreEntries: '3-5',
        loreWords: '30-70',
        tokenCap: 1800,
        loreTokens: 1400,
    },
    {
        id: 'standard',
        label: 'Standard',
        hint: 'Playable card. Balanced cost and quality.',
        descriptionWords: '120-260',
        personalityWords: '80-180',
        scenarioWords: '40-120',
        greetingWords: '80-180',
        exampleTurns: '2-4',
        altGreetings: '2-3',
        loreEntries: '5-10',
        loreWords: '50-120',
        tokenCap: 0,
        loreTokens: 2800,
    },
    {
        id: 'rich',
        label: 'Rich',
        hint: 'Longer fields and a denser lorebook.',
        descriptionWords: '200-360',
        personalityWords: '140-240',
        scenarioWords: '80-160',
        greetingWords: '120-220',
        exampleTurns: '3-5',
        altGreetings: '3-4',
        loreEntries: '8-14',
        loreWords: '70-150',
        tokenFloor: 4000,
        tokenCap: 0,
        loreTokens: 4000,
    },
    {
        id: 'masterpiece',
        label: 'Masterpiece',
        hint: 'Ambitious. Dense card and a large lorebook.',
        descriptionWords: '280-480',
        personalityWords: '180-320',
        scenarioWords: '100-200',
        greetingWords: '140-260',
        exampleTurns: '4-6',
        altGreetings: '3-5',
        loreEntries: '12-20',
        loreWords: '90-180',
        tokenFloor: 8000,
        tokenCap: 0,
        loreTokens: 6000,
    },
];

export const DEFAULT_SETTINGS = {
    slopThreshold: 55,
    defaultCreativity: 45,
    defaultDetail: 'standard',
    maxResponseTokens: 0,
    autoImportLorebook: true,
    compactMobile: true,
    creatorName: '',
    errorLogSeq: 0,
    errorLogs: [],
};

export function getDetailPreset(id) {
    return DETAIL_PRESETS.find((item) => item.id === id) || DETAIL_PRESETS[1];
}

export const CHARACTER_FIELD_STEPS = [
    { id: 'name', label: 'Name', kind: 'string' },
    { id: 'description', label: 'Description', kind: 'string', wordsKey: 'descriptionWords' },
    { id: 'personality', label: 'Personality', kind: 'string', wordsKey: 'personalityWords' },
    { id: 'scenario', label: 'Scenario', kind: 'string', wordsKey: 'scenarioWords' },
    { id: 'first_mes', label: 'First message', kind: 'string', wordsKey: 'greetingWords' },
    { id: 'mes_example', label: 'Example messages', kind: 'string' },
    { id: 'alternate_greetings', label: 'Alternate greetings', kind: 'array' },
    { id: 'extras', label: 'Director notes', kind: 'object' },
];

export const PERSONA_FIELD_STEPS = [
    { id: 'name', label: 'Name', kind: 'string' },
    { id: 'title', label: 'Title', kind: 'string' },
    { id: 'description', label: 'Description', kind: 'string', wordsKey: 'descriptionWords' },
    { id: 'personality', label: 'Personality', kind: 'string', wordsKey: 'personalityWords' },
];

