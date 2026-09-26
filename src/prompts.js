import { getDetailPreset } from './constants.js';
import { creativityLabel } from './utils.js';

const SHARED_RULES = `You are a senior SillyTavern cardwright. You write one requested piece at a time.

Hard rules:
- Return ONLY valid JSON. No markdown fences, no commentary, no preamble.
- Never write "as an AI", jailbreak text, or notes addressed to the model.
- Do not dump later fields into this answer. Write ONLY the requested field.
- Prefer concrete, playable detail over aesthetic adjectives.
- Avoid slop: glowing orbs, lingering scents, smirk playing on lips, porcelain/alabaster skin, "can't help but", "aura of", "defies description", "not like other girls", "touch her and you die", "dominant yet submissive", tragic-mystery-with-no-content, and synonym salad.
- Do not sexualize a character unless the user explicitly asked for adult content.
- Use {{char}} and {{user}} macros where they help the model stay consistent.
- Stay loyal to the original concept. Already-written fields are locked unless this step is a remake of that same field.`;

function resolveDetail(detail) {
    if (detail && typeof detail === 'object' && detail.id) return detail;
    return getDetailPreset(detail);
}

function creativityBlock(level) {
    const n = Number(level) || 45;
    return `Creativity slider: ${n}/100 (${creativityLabel(n)}).
- 0-20: stay extremely close to the user's wording. Invent only missing mechanical fields.
- 21-40: fill gaps, keep tone and facts faithful.
- 41-60: add texture, specific habits, and a lived-in world.
- 61-80: take smart liberties with names, factions, and complications.
- 81-100: surprise the user, but do not abandon the core concept.`;
}

const STACK_FIELDS = [
    ['name', 'Name'],
    ['title', 'Title'],
    ['description', 'Description'],
    ['personality', 'Personality'],
    ['scenario', 'Scenario'],
    ['first_mes', 'First message'],
    ['mes_example', 'Example messages'],
    ['alternate_greetings', 'Alternate greetings'],
    ['system_prompt', 'System prompt'],
    ['post_history_instructions', 'Post-history instructions'],
    ['creator_notes', 'Creator notes'],
    ['tags', 'Tags'],
    ['talkativeness', 'Talkativeness'],
    ['depth_prompt', 'Depth prompt'],
    ['creator', 'Creator'],
];

function hasValue(value) {
    if (Array.isArray(value)) return value.filter(Boolean).length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    return Boolean(String(value ?? '').trim());
}

function printValue(value) {
    if (Array.isArray(value)) return value.filter(Boolean).join('\n---\n');
    if (typeof value === 'number') return String(value);
    return String(value ?? '').trim();
}

export function buildPromptStack({ concept = '', extra = '', critique = '', draft = {}, sourceCard = '', mode = 'generate' } = {}) {
    const parts = [];
    if (mode === 'remake') {
        parts.push('Mode: remake. Keep the soul of the source card unless the user asked to change it.');
        parts.push('Priority: user extra direction, then analyzer critique, then recognizability.');
    } else {
        parts.push('Mode: generate from a concept. Invent supporting detail if the concept is thin. Do not invent a different concept.');
    }
    parts.push(`CONCEPT:\n${concept || '(none given)'}`);
    if (extra) parts.push(`EXTRA DIRECTION:\n${extra}`);
    if (critique) parts.push(`ANALYZER CRITIQUE:\n${critique}`);
    if (mode === 'remake' && sourceCard) {
        parts.push(`ORIGINAL CARD BEING REMADE:\n${sourceCard}`);
    }
    const stacked = STACK_FIELDS.filter(([key]) => hasValue(draft?.[key]));
    if (stacked.length) {
        parts.push(['ALREADY BUILT — treat this as locked context:', ...stacked.map(([key, label]) => `${label}:\n${printValue(draft[key])}`)].join('\n\n'));
    } else {
        parts.push('ALREADY BUILT: nothing yet. This is the first field.');
    }
    return parts.join('\n\n');
}

export function formatWholeCard(card) {
    if (!card) return '(no card)';
    if (typeof card === 'string') return card;
    const rows = STACK_FIELDS.filter(([key]) => hasValue(card[key]));
    if (!rows.length) return JSON.stringify(card, null, 2);
    return rows.map(([key, label]) => `${label}:\n${printValue(card[key])}`).join('\n\n');
}

const FIELD_GUIDE = {
    name: {
        purpose: 'NAME is the playable character label. It is what the user picks in the character list and what {{char}} refers to.',
        instruction: 'Write one usable personal name. Not a title dump, not a job plus three adjectives, not "X the Y of Z" unless that is truly the name.',
        shape: '{ "name": "" }',
        words: () => '1-5 words',
    },
    description: {
        purpose: 'DESCRIPTION is what a stranger would notice in the room. Body, clothes, posture, tells, how they occupy space. It is NOT personality, backstory, or scenario.',
        instruction: 'Write only physical presence and immediately visible facts. No motives. No life story. No "she is kind but deadly".',
        shape: '{ "description": "" }',
        words: (preset) => preset.descriptionWords,
    },
    personality: {
        purpose: 'PERSONALITY is how they choose. Motives, social style, hard lines, how they treat {{user}}. It is NOT appearance and not the opening scene.',
        instruction: 'Write playable contradictions, not "kind but deadly". Stay consistent with the locked description.',
        shape: '{ "personality": "" }',
        words: (preset) => preset.personalityWords,
    },
    scenario: {
        purpose: 'SCENARIO is the opening situation: where we are, why {{user}} is here, the current tension. It is not a novel and not a biography.',
        instruction: 'Write the starting scene only. Do not recap the description or personality.',
        shape: '{ "scenario": "" }',
        words: (preset) => preset.scenarioWords,
    },
    first_mes: {
        purpose: 'FIRST MESSAGE is the in-character opening the model will send as {{char}}. It must be answerable.',
        instruction: 'Ground it in a place and an action. End on something {{user}} can answer. No "who are you traveler" unless that is the joke.',
        shape: '{ "first_mes": "" }',
        words: (preset) => preset.greetingWords,
    },
    mes_example: {
        purpose: 'EXAMPLE MESSAGES teach the model the character\'s voice. They are a short transcript, not a plot recap.',
        instruction: 'Use this format only:\n{{user}}: ...\n{{char}}: ...\nShow voice, not story.',
        shape: '{ "mes_example": "" }',
        words: (preset) => `${preset.exampleTurns} short exchanges`,
    },
    alternate_greetings: {
        purpose: 'ALTERNATE GREETINGS are extra first messages from different beats or moods. They are swipe options, not more personality text.',
        instruction: 'Each item is a full in-character opening, distinct from first_mes and from each other. Empty array only on Sketch if you truly have nothing extra.',
        shape: '{ "alternate_greetings": [""] }',
        words: (preset) => `${preset.altGreetings} greetings`,
    },
    extras: {
        purpose: 'DIRECTOR NOTES are optional machine/human instructions. They are not more lore and not more personality.',
        instruction: 'Fill only what helps. Use empty strings / empty arrays when a field is unnecessary.\n- system_prompt: short director note for the model\n- post_history_instructions: 1-3 sentences about formatting, length, and what never to do\n- creator_notes: out-of-character notes for the human\n- tags: 4-10 short tags\n- talkativeness: 0.2-0.9\n- depth_prompt: short in-world reminder, or empty\n- creator: leave empty unless the user named one',
        shape: `{
  "system_prompt": "",
  "post_history_instructions": "",
  "creator_notes": "",
  "tags": [""],
  "creator": "",
  "character_version": "1.0",
  "talkativeness": 0.5,
  "depth_prompt": ""
}`,
        words: () => 'keep short',
    },
    title: {
        purpose: 'TITLE is the short label shown in the persona list. It is not the persona name.',
        instruction: 'A few words, or an empty string.',
        shape: '{ "title": "" }',
        words: () => '0-6 words',
    },
};

export function buildFieldPrompt({
    field,
    concept,
    extra = '',
    critique = '',
    sourceCard = '',
    draft = {},
    creativity,
    detail = 'standard',
    mode = 'generate',
} = {}) {
    const preset = resolveDetail(detail);
    const guide = FIELD_GUIDE[field] || FIELD_GUIDE.description;
    return `${SHARED_RULES}

${creativityBlock(creativity)}

Detail preset: ${preset.label} (${preset.id}). Target length for this field: ${guide.words(preset)}.

What this field is for:
${guide.purpose}

This step:
${guide.instruction}

Write ONLY this field. Use the stacked context below in this exact order: concept, then every already-built field. Do not rewrite earlier fields.

${buildPromptStack({ concept, extra, critique, draft, sourceCard, mode })}

JSON shape:
${guide.shape}`;
}

export function buildLorebookPrompt({ concept, creativity, extra = '', critique = '', detail = 'standard', card = null, sourceCard = '', mode = 'generate' } = {}) {
    const preset = resolveDetail(detail);
    return `${SHARED_RULES}

${creativityBlock(creativity)}

What a lorebook / world-info file is for:
A lorebook is NOT the character card. It is keyed background the chat model only sees when a trigger word appears.
Use it for load-bearing facts that would bloat the card: places, factions, named people, rules, objects, history beats.
Each entry must stand alone. Do not recap description/personality/scenario. Do not write second-person "you". Do not write dialogue examples.

How to fill the fields:
- name: short book title
- description: one or two sentences about what the book covers
- comment: short entry title
- keys: 3-8 phrases that would actually appear in chat and should summon this fact
- content: ${preset.loreWords} words, third person, present or simple past
- constant: true only for 0-2 framing entries that must always be in context
- insertion_order: lower numbers insert earlier. Default 100.

Write ${preset.loreEntries} entries. Do not return an empty entries array. Do not invent a different setting than the finished card.

This lorebook prompt is: CONCEPT + the WHOLE finished character card.

${buildPromptStack({ concept, extra, critique, draft: card || {}, sourceCard, mode })}

WHOLE FINISHED CHARACTER CARD:
${formatWholeCard(card)}

JSON shape:
{
  "name": "",
  "description": "",
  "entries": [
    {
      "comment": "",
      "keys": [""],
      "content": "",
      "constant": false,
      "insertion_order": 100
    }
  ]
}`;
}

export function buildPersonaFieldPrompt(options) {
    return buildFieldPrompt(options);
}

export function buildAiSlopPrompt(cardText) {
    return `You are a harsh but fair SillyTavern card editor. Grade this character card for slop.

Slop means: cliche prose, mashed fields, jailbreak leftovers, empty mystery, synonym salad, unplayable structure, missing fields, and filler that wastes context.

Hard rules:
- Return ONLY valid JSON. No markdown fences, no commentary, no preamble.
- score is 0-100. Higher = sloppier. 0 is a tight playable card. 100 is sludge.
- Be specific. Quote the card. Do not invent fields that are not there.
- Empty or stub fields are serious. Identical description/personality is serious.
- Do not reward length. Reward playable, concrete detail.

JSON shape:
{
  "score": 0,
  "summary": "2-4 sentences. What this card is, and why the score is what it is.",
  "breakdown": {
    "cliches": 0,
    "completeness": 0,
    "formatting": 0,
    "repetition": 0,
    "bloat": 0
  },
  "issues": [
    {
      "type": "cliches|completeness|formatting|repetition|bloat|jailbreak|voice",
      "severity": "critical|high|medium|low",
      "description": "What is wrong, with a short quote.",
      "suggestion": "How to fix it."
    }
  ],
  "recommendations": ["Highest-leverage rewrite steps."]
}

breakdown values are 0-100. Higher = worse on that axis.
Give 3-8 issues. Give 2-5 recommendations.

Card:
${cardText}`;
}

export { resolveDetail };
