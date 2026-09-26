import { creativityLabel } from './utils.js';

const SHARED_RULES = `You are a senior SillyTavern cardwright. You write character cards, lorebooks, and personas that are actually usable in play.

Hard rules:
- Return ONLY valid JSON. No markdown fences, no commentary, no preamble.
- Never write "as an AI", jailbreak text, or notes addressed to the model.
- Do not dump appearance, personality, backstory, and scenario into one blob.
- Prefer concrete, playable detail over aesthetic adjectives.
- Avoid slop: glowing orbs, lingering scents, smirk playing on lips, porcelain/alabaster skin, "can't help but", "aura of", "defies description", "not like other girls", "touch her and you die", "dominant yet submissive", tragic-mystery-with-no-content, and synonym salad.
- Do not sexualize a character unless the user explicitly asked for adult content.
- Use {{char}} and {{user}} macros where they help the model stay consistent.
- Keep tokens tight. Every sentence should earn its place.
- If the user's concept is thin, invent supporting detail that still matches the request. Do not invent a different concept.`;

function creativityBlock(level) {
    const n = Number(level) || 45;
    return `Creativity slider: ${n}/100 (${creativityLabel(n)}).
- 0-20: stay extremely close to the user's wording. Invent only missing mechanical fields.
- 21-40: fill gaps, keep tone and facts faithful.
- 41-60: add texture, specific habits, and a lived-in world.
- 61-80: take smart liberties with names, factions, and complications.
- 81-100: surprise the user, but do not abandon the core concept.`;
}

export function buildCharacterPrompt({ concept, creativity, extra = '', includeLorebook = false }) {
    return `${SHARED_RULES}

${creativityBlock(creativity)}

Task: build a SillyTavern Character Card V2 from the user's concept.

Field guidance:
- name: a real usable name, not a title dump.
- description: 120-260 words. Physical presence, how they occupy space, what a stranger would notice, one or two telling details. No personality essay here.
- personality: 80-180 words. Motivations, social style, hard lines, how they treat {{user}}. Use contradictions that can actually play, not "kind but deadly".
- scenario: 40-120 words. Where we are, why {{user}} is here, the current tension. Write it as the opening situation, not a novel.
- first_mes: 80-180 words. In-character opening. Ground it in a place and an action. End on something {{user}} can answer. No "who are you traveler" unless that is the joke.
- mes_example: 2-4 short exchanges using this format:
  {{user}}: ...
  {{char}}: ...
  Show voice, not plot recap.
- alternate_greetings: 2-3 alternate first messages from different beats or moods.
- system_prompt: optional short director's note for the model. Empty string if unnecessary.
- post_history_instructions: 1-3 sentences about formatting, length, and what never to do. Empty string if unnecessary.
- creator_notes: out-of-character usage notes for the human, not the model. Mention intended tone, any lore assumptions, and what the card is NOT.
- tags: 4-10 short tags.
- talkativeness: 0.2-0.9.
- depth_prompt: a short in-world reminder inserted at depth, or empty.
${includeLorebook ? `- lorebook: 4-10 world-info entries the card actually needs (people, places, rules, items). Skip cosmetic entries.
  Each entry: comment (short title), keys (3-8 trigger phrases), content (40-120 words, third person, no "you"), constant (true only for always-on framing), insertion_order (lower = earlier).` : '- lorebook: always return an empty array.'}

User concept:
${concept}
${extra ? `\nAdditional direction:\n${extra}` : ''}

JSON shape:
{
  "name": "",
  "description": "",
  "personality": "",
  "scenario": "",
  "first_mes": "",
  "mes_example": "",
  "alternate_greetings": [""],
  "system_prompt": "",
  "post_history_instructions": "",
  "creator_notes": "",
  "tags": [""],
  "creator": "",
  "character_version": "1.0",
  "talkativeness": 0.5,
  "depth_prompt": "",
  "lorebook": [
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

export function buildLorebookPrompt({ concept, creativity, extra = '' }) {
    return `${SHARED_RULES}

${creativityBlock(creativity)}

Task: build a SillyTavern lorebook / world info file from the user's concept.

Entry rules:
- 6-14 entries. Cover the load-bearing facts: places, factions, people, rules, objects, history beats.
- keys must be phrases that would actually appear in chat.
- content is third person, present or simple past, no second-person "you".
- constant=true only for 0-2 framing entries that must always be in context.
- Keep each content block 40-140 words. No novels.
- Do not repeat the same fact across entries.

User concept:
${concept}
${extra ? `\nAdditional direction:\n${extra}` : ''}

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

export function buildPersonaPrompt({ concept, creativity, extra = '' }) {
    return `${SHARED_RULES}

${creativityBlock(creativity)}

Task: build a SillyTavern user PERSONA, not a bot card.

This describes {{user}} for the model. It is worn by the human player.
- name: the persona's name.
- description: 80-180 words. How this person looks, sounds, and occupies a scene. Write so a bot can react to them.
- personality: 60-140 words. How they treat other people, what they want, what they will not do.
- title: optional short label shown in the persona list.

Do not write a first message. Do not write example messages. Do not write system prompts.

User concept:
${concept}
${extra ? `\nAdditional direction:\n${extra}` : ''}

JSON shape:
{
  "name": "",
  "title": "",
  "description": "",
  "personality": ""
}`;
}

export function buildRemakePrompt({ cardText, creativity, extra = '', critique = '', includeLorebook = true }) {
    return `${SHARED_RULES}

${creativityBlock(creativity)}

Task: remake the uploaded character card. Keep the soul of the character (name, role, relationships, setting) unless the user asked to change them. Fix slop, split mashed fields, replace cliches with specific detail, and write a card a good model can actually play.

Priority:
1. User extra direction, if any. Follow it even when it disagrees with the critique.
2. Analyzer critique. Treat every listed issue as a required fix unless the user overrode it.
3. Keep the character recognizable.

Also produce a lorebook if the character needs one (setting rules, named people, places, items). If the world is tiny, return an empty lorebook array.
Keep the JSON compact enough to finish. Prefer 4-8 lore entries over a novel.

Current card:
${cardText}
${critique ? `\nAnalyzer critique to apply:\n${critique}` : ''}
${extra ? `\nAdditional user direction (wins if it conflicts with the critique):\n${extra}` : ''}

JSON shape:
{
  "name": "",
  "description": "",
  "personality": "",
  "scenario": "",
  "first_mes": "",
  "mes_example": "",
  "alternate_greetings": [""],
  "system_prompt": "",
  "post_history_instructions": "",
  "creator_notes": "",
  "tags": [""],
  "creator": "",
  "character_version": "1.1",
  "talkativeness": 0.5,
  "depth_prompt": "",
  "lorebook": ${includeLorebook ? `[
    {
      "comment": "",
      "keys": [""],
      "content": "",
      "constant": false,
      "insertion_order": 100
    }
  ]` : '[]'}
}`;
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
