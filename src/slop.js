import { clamp } from './utils.js';

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
        depth_prompt: data.depth_prompt || data.extensions?.depth_prompt?.prompt || '',
    };
    return JSON.stringify(payload, null, 2);
}

function asIssue(item) {
    if (!item) return null;
    if (typeof item === 'string') {
        const text = item.trim();
        if (!text) return null;
        return {
            type: 'judgement',
            severity: 'medium',
            description: text,
            suggestion: '',
        };
    }
    const description = String(item.description || item.issue || item.problem || item.text || '').trim();
    if (!description) return null;
    const severity = String(item.severity || 'medium').toLowerCase();
    return {
        type: String(item.type || item.category || 'judgement'),
        severity: ['critical', 'high', 'medium', 'low'].includes(severity) ? severity : 'medium',
        description,
        suggestion: String(item.suggestion || item.fix || item.advice || '').trim(),
    };
}

function numberOr(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Turn a model judgement into the shape the Analyze UI expects.
 * Higher score = sloppier.
 */
export function normalizeAiJudgement(raw, { threshold = 55 } = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('The model did not return a slop judgement object.');
    }

    const score = clamp(Math.round(numberOr(raw.score, NaN)), 0, 100);
    if (!Number.isFinite(Number(raw.score))) {
        throw new Error('The model judgement was missing a numeric score.');
    }

    const src = raw.breakdown && typeof raw.breakdown === 'object' ? raw.breakdown : {};
    const breakdown = {
        creativity: clamp(Math.round(numberOr(src.cliches ?? src.creativity)), 0, 100),
        completeness: clamp(Math.round(numberOr(src.completeness)), 0, 100),
        formatting: clamp(Math.round(numberOr(src.formatting)), 0, 100),
        repetition: clamp(Math.round(numberOr(src.repetition)), 0, 100),
        tokenEfficiency: clamp(Math.round(numberOr(src.bloat ?? src.tokenEfficiency ?? src.token_efficiency)), 0, 100),
    };

    const issues = [];
    const seen = new Set();
    const rawIssues = Array.isArray(raw.issues) ? raw.issues : [];
    for (const item of rawIssues) {
        const issue = asIssue(item);
        if (!issue) continue;
        const key = `${issue.type}:${issue.description}`;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push(issue);
    }

    const recommendations = [];
    const recSource = [
        ...(Array.isArray(raw.recommendations) ? raw.recommendations : []),
        ...(Array.isArray(raw.fixes) ? raw.fixes : []),
    ];
    for (const rec of recSource) {
        const text = String(rec || '').trim();
        if (text && !recommendations.includes(text)) recommendations.push(text);
    }

    const summary = String(raw.summary || raw.verdict || '').trim();
    if (!issues.length && summary) {
        issues.push({
            type: 'judgement',
            severity: score >= 65 ? 'high' : score >= 45 ? 'medium' : 'low',
            description: summary,
            suggestion: recommendations[0] || '',
        });
    }

    return {
        score,
        isSlop: score >= threshold,
        breakdown,
        issues: issues.slice(0, 16),
        recommendations: recommendations.slice(0, 8),
        aiSummary: summary,
        aiFixes: recommendations,
        source: 'ai',
    };
}
