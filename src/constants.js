export const EXTENSION_NAME = 'SillyTavern-Card-Crafter';
export const MODULE_NAME = 'cardCrafter';
export const VERSION = '1.2.0';
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

export const DEFAULT_SETTINGS = {
    slopThreshold: 55,
    defaultCreativity: 45,
    maxResponseTokens: 0,
    autoImportLorebook: true,
    compactMobile: true,
    creatorName: '',
    errorLogSeq: 0,
    errorLogs: [],
};

