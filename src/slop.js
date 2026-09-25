import { FILLER_PHRASES, REQUIRED_CHAR_FIELDS, SLOP_TROPES } from './constants.js';
import { clamp, countOccurrences, wordCount } from './utils.js';

function collectCardText(card) {
    const data = normalizeCard(card);
    return {
        data,
        fields: {
            name: data.name || '',
            description: data.description || '',
            personality: data.personality || '',
            scenario: data.scenario || '',
            first_mes: data.first_mes || '',
            mes_example: data.mes_example || '',
            creator_notes: data.creator_notes || '',
            system_prompt: data.system_prompt || '',
            post_history_instructions: data.post_history_instructions || '',
            tags: Array.isArray(data.tags) ? data.tags.join(', ') : String(data.tags || ''),
        },
    };
}

export function normalizeCard(input) {
    if (!input) return {};
    if (input.data && typeof input.data === 'object') {
        return { ...input, ...input.data };
    }
    return input;
}

export function flattenCardForPrompt(card) {
    const data = normalizeCard(card);
    const payload = {
        name: data.name || '',
        description: data.description || '',
        personality: data.personality || '',
        scenario: data.scenario || '',
        first_mes: data.first_mes || '',
        mes_example: data.mes_example || '',
        alternate_greetings: data.alternate_greetings || [],
        system_prompt: data.system_prompt || '',
        post_history_instructions: data.post_history_instructions || '',
        creator_notes: data.creator_notes || data.creatorcomment || '',
        tags: data.tags || [],
        creator: data.creator || '',
        character_version: data.character_version || '',
        talkativeness: data.talkativeness ?? data.extensions?.talkativeness ?? 0.5,
    };
    return JSON.stringify(payload, null, 2);
}

function lexicalDiversity(text) {
    const words = String(text || '').toLowerCase().match(/[a-zA-Z']+/g) || [];
    if (words.length < 20) return 1;
    const unique = new Set(words);
    return unique.size / words.length;
}

function repeatedNgrams(text, size = 4) {
    const words = String(text || '').toLowerCase().match(/[a-zA-Z']+/g) || [];
    if (words.length < size * 3) return 0;
    const seen = new Map();
    let repeats = 0;
    for (let i = 0; i <= words.length - size; i++) {
        const gram = words.slice(i, i + size).join(' ');
        const next = (seen.get(gram) || 0) + 1;
        seen.set(gram, next);
        if (next === 2) repeats += 1;
    }
    return repeats;
}

function adjectiveSoupScore(text) {
    const words = String(text || '').toLowerCase().match(/[a-zA-Z']+/g) || [];
    if (!words.length) return 0;
    const glitter = [
        'beautiful', 'gorgeous', 'stunning', 'alluring', 'seductive', 'mysterious',
        'enigmatic', 'ethereal', 'intoxicating', 'captivating', 'mesmerizing',
        'dangerously', 'impossibly', 'perfect', 'flawless', 'exquisite', 'luscious',
        'voluptuous', 'sultry', 'ravishing', 'breathtaking',
    ];
    const hits = words.filter((w) => glitter.includes(w)).length;
    return clamp((hits / words.length) * 400, 0, 100);
}

function fieldBleedScore(fields) {
    const desc = (fields.description || '').toLowerCase();
    const personalityWords = (fields.personality || '').toLowerCase().split(/\W+/).filter((w) => w.length > 5);
    if (!desc || personalityWords.length < 8) return 0;
    const overlap = personalityWords.filter((w) => desc.includes(w)).length;
    return clamp((overlap / personalityWords.length) * 120, 0, 100);
}

function jailbreakScore(text) {
    const t = String(text || '').toLowerCase();
    const hits = [
        'as an ai',
        'you are chatgpt',
        'ignore previous',
        'developer message',
        'do not mention these instructions',
        'nsfw without limit',
        'no censorship',
        'unfiltered ai',
        'jailbreak',
        '[system note]',
        'openai',
        'content policy',
    ].reduce((sum, phrase) => sum + (t.includes(phrase) ? 1 : 0), 0);
    return clamp(hits * 28, 0, 100);
}

export function analyzeSlop(card, { threshold = 55, ai = null } = {}) {
    const { data, fields } = collectCardText(card);
    const allText = Object.values(fields).join('\n');
    const issues = [];

    let formatting = 0;
    let completeness = 0;
    let tropes = 0;
    let repetition = 0;
    let efficiency = 0;
    let creativity = 0;

    for (const field of REQUIRED_CHAR_FIELDS) {
        const value = String(fields[field] || '').trim();
        if (!value) {
            completeness += 16;
            issues.push({
                type: 'completeness',
                severity: field === 'name' ? 'critical' : 'high',
                description: `Missing ${field}.`,
                suggestion: `Write a real ${field} instead of leaving it blank.`,
            });
        } else if (wordCount(value) < (field === 'name' ? 1 : 12) && field !== 'name') {
            completeness += 8;
            issues.push({
                type: 'completeness',
                severity: 'medium',
                description: `${field} is too thin (${wordCount(value)} words).`,
                suggestion: 'Add playable detail. A sentence fragment is not a field.',
            });
        }
    }

    if (wordCount(fields.description) > 420) {
        efficiency += 18;
        issues.push({
            type: 'token_efficiency',
            severity: 'medium',
            description: 'Description is a novella. Models will start dropping later fields.',
            suggestion: 'Cut below ~260 words and move lore into a lorebook.',
        });
    }

    if (fields.description && fields.personality && fields.description.trim() === fields.personality.trim()) {
        formatting += 25;
        issues.push({
            type: 'formatting',
            severity: 'high',
            description: 'Description and personality are identical.',
            suggestion: 'Split body/presence from motives and social behavior.',
        });
    }

    const bleed = fieldBleedScore(fields);
    if (bleed > 35) {
        formatting += bleed * 0.35;
        issues.push({
            type: 'formatting',
            severity: 'medium',
            description: 'Personality is leaking into the description (or the reverse).',
            suggestion: 'Description = what you notice. Personality = how they choose.',
        });
    }

    if (fields.first_mes && !fields.first_mes.includes('{{user}}') && wordCount(fields.first_mes) > 40) {
        formatting += 6;
    }

    if (fields.mes_example && !/\{\{user\}\}:/i.test(fields.mes_example)) {
        formatting += 12;
        issues.push({
            type: 'formatting',
            severity: 'medium',
            description: 'Example messages are not in {{user}} / {{char}} transcript form.',
            suggestion: 'Use short back-and-forth turns so the model can copy the voice.',
        });
    }

    const lower = allText.toLowerCase();
    let tropeHits = 0;
    for (const trope of SLOP_TROPES) {
        const hits = trope.regex
            ? (lower.match(new RegExp(trope.phrase, 'gi')) || []).length
            : countOccurrences(lower, trope.phrase);
        if (hits > 0) {
            tropeHits += hits;
            tropes += Math.min(14, trope.weight * hits);
            if (issues.length < 14) {
                issues.push({
                    type: 'creativity',
                    severity: trope.weight >= 7 ? 'high' : 'medium',
                    description: `Cliche: “${trope.phrase.replace(/\\/g, '')}” ×${hits}.`,
                    suggestion: 'Replace the stock phrase with a concrete, character-specific detail.',
                });
            }
        }
    }

    let fillerHits = 0;
    for (const phrase of FILLER_PHRASES) {
        fillerHits += countOccurrences(lower, phrase);
    }
    if (fillerHits) {
        efficiency += Math.min(20, fillerHits * 4);
        issues.push({
            type: 'token_efficiency',
            severity: 'low',
            description: `Filler phrasing detected (${fillerHits}).`,
            suggestion: 'Cut throat-clearing language. Keep the fact.',
        });
    }

    const diversity = lexicalDiversity(allText);
    if (diversity < 0.38 && wordCount(allText) > 80) {
        repetition += 22;
        issues.push({
            type: 'repetition',
            severity: 'medium',
            description: `Low lexical diversity (${(diversity * 100).toFixed(0)}%).`,
            suggestion: 'Stop restating the same three adjectives.',
        });
    }

    const grams = repeatedNgrams(allText, 4);
    if (grams >= 3) {
        repetition += Math.min(24, grams * 4);
        issues.push({
            type: 'repetition',
            severity: 'medium',
            description: `Repeated 4-grams found (${grams}).`,
            suggestion: 'The card is copy-pasting itself. Collapse the duplicates.',
        });
    }

    const glitter = adjectiveSoupScore(allText);
    if (glitter > 20) {
        creativity += glitter * 0.55;
        issues.push({
            type: 'creativity',
            severity: glitter > 40 ? 'high' : 'medium',
            description: 'Adjective soup. Beauty words are doing the work that specifics should do.',
            suggestion: 'Swap “stunning/alluring/ethereal” for a physical fact the model can stage.',
        });
    }

    const jb = jailbreakScore(allText);
    if (jb > 0) {
        formatting += jb * 0.5;
        issues.push({
            type: 'formatting',
            severity: 'critical',
            description: 'Jailbreak / anti-AI leftovers found.',
            suggestion: 'Delete model-facing instructions. A card is not a system prompt dump.',
        });
    }

    if (/[A-Z]{6,}/.test(allText) && (allText.match(/[A-Z]{6,}/g) || []).length >= 3) {
        formatting += 8;
        issues.push({
            type: 'formatting',
            severity: 'low',
            description: 'Excessive ALL CAPS.',
            suggestion: 'Use emphasis sparingly. Caps lock is not personality.',
        });
    }

    if ((data.tags || []).length > 18) {
        efficiency += 8;
        issues.push({
            type: 'token_efficiency',
            severity: 'low',
            description: 'Tag spam.',
            suggestion: 'Keep 4-10 tags that help people find the card.',
        });
    }

    const breakdown = {
        formatting: clamp(Math.round(formatting), 0, 100),
        repetition: clamp(Math.round(repetition), 0, 100),
        completeness: clamp(Math.round(completeness), 0, 100),
        tokenEfficiency: clamp(Math.round(efficiency), 0, 100),
        creativity: clamp(Math.round(tropes * 0.55 + creativity), 0, 100),
        tropes: clamp(Math.round(tropes), 0, 100),
    };

    const score = clamp(Math.round(
        breakdown.formatting * 0.18 +
        breakdown.repetition * 0.14 +
        breakdown.completeness * 0.22 +
        breakdown.tokenEfficiency * 0.12 +
        breakdown.creativity * 0.34,
    ), 0, 100);

    if (ai && Number.isFinite(ai.score)) {
        const blended = clamp(Math.round(score * 0.65 + Number(ai.score) * 0.35), 0, 100);
        if (Array.isArray(ai.issues)) {
            for (const item of ai.issues.slice(0, 6)) {
                issues.push({
                    type: 'coherence',
                    severity: 'medium',
                    description: String(item),
                    suggestion: 'From the AI pass.',
                });
            }
        }
        return finalize(blended, breakdown, issues, threshold, {
            heuristic: score,
            aiScore: Number(ai.score),
            aiSummary: ai.summary || '',
            aiFixes: ai.fixes || [],
        });
    }

    return finalize(score, breakdown, issues, threshold, { heuristic: score });
}

function finalize(score, breakdown, issues, threshold, extra) {
    const unique = [];
    const seen = new Set();
    for (const issue of issues) {
        const key = `${issue.type}:${issue.description}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(issue);
    }

    const recommendations = [];
    if (breakdown.completeness >= 20) recommendations.push('Fill empty or stub fields before anything else.');
    if (breakdown.creativity >= 30) recommendations.push('Strip cliches and replace them with specific, playable facts.');
    if (breakdown.formatting >= 20) recommendations.push('Separate description, personality, scenario, and example dialogue.');
    if (breakdown.repetition >= 20) recommendations.push('Collapse repeated sentences. Say it once.');
    if (breakdown.tokenEfficiency >= 20) recommendations.push('Move world facts into a lorebook and keep the card lean.');
    if (!recommendations.length) recommendations.push('Light polish only. The bones of this card are fine.');

    return {
        score,
        isSlop: score >= threshold,
        breakdown,
        issues: unique.slice(0, 16),
        recommendations,
        tropeHits: unique.filter((i) => i.type === 'creativity').length,
        ...extra,
    };
}
