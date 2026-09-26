import {
    generateCharacter,
    generateLorebook,
    generatePersona,
    gradeCardWithAi,
    isAbortError,
    remakeCharacter,
} from './generate.js';
import { flattenCardForPrompt, normalizeAiJudgement } from './slop.js';
import { logError, logWarn } from './error-log.js';

const listeners = new Set();
/** @type {Map<string, object>} */
const jobs = new Map();
let seq = 0;

export function subscribeJobs(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function emit(job) {
    for (const listener of [...listeners]) {
        try {
            listener(job);
        } catch (error) {
            logWarn(error, { source: 'job-listener', extra: { jobId: job?.id, status: job?.status } });
        }
    }
}

function makeId(kind) {
    seq += 1;
    return `${kind}-${Date.now().toString(36)}-${seq}`;
}

export function listJobs() {
    return [...jobs.values()].sort((a, b) => a.startedAt - b.startedAt);
}

export function getJob(id) {
    return jobs.get(id) || null;
}

export function getActiveJob() {
    return listJobs().find((job) => job.status === 'running') || null;
}

export function getLatestJob(kind) {
    const matches = listJobs().filter((job) => !kind || job.kind === kind);
    return matches.at(-1) || null;
}

export function abortJob(id) {
    const job = typeof id === 'string' ? jobs.get(id) : getActiveJob();
    if (!job || job.status !== 'running') return false;
    job.controller.abort();
    job.status = 'stopped';
    job.error = 'Stopped.';
    emit(job);
    return true;
}

export function abortAllJobs() {
    for (const job of jobs.values()) {
        if (job.status === 'running') abortJob(job.id);
    }
}

export function dismissJob(id) {
    const job = jobs.get(id);
    if (!job || job.status === 'running') return;
    jobs.delete(id);
    emit(job);
}

function createJob({ kind, label, meta = {} }) {
    const active = getActiveJob();
    if (active) abortJob(active.id);

    const controller = new AbortController();
    const job = {
        id: makeId(kind),
        kind,
        label,
        meta,
        status: 'running',
        text: '',
        reasoning: '',
        streaming: true,
        fallback: false,
        step: 0,
        total: 0,
        stepLabel: '',
        result: null,
        error: '',
        startedAt: Date.now(),
        finishedAt: 0,
        controller,
    };
    jobs.set(job.id, job);
    emit(job);
    return job;
}

function finishJob(job, { status, result = null, error = '' } = {}) {
    if (!jobs.has(job.id)) return job;
    if (job.status !== 'running' && job.status !== status) {
        job.finishedAt = job.finishedAt || Date.now();
        emit(job);
        return job;
    }
    job.status = status;
    job.result = result;
    job.error = error;
    job.finishedAt = Date.now();
    emit(job);
    return job;
}

function attachStream(job) {
    return ({ text = '', reasoning = '', streaming = true, fallback = false, step, total, label } = {}) => {
        if (job.status !== 'running') return;
        job.text = String(text || '');
        job.reasoning = String(reasoning || '');
        job.streaming = Boolean(streaming);
        if (fallback) job.fallback = true;
        if (step) job.step = Number(step) || job.step;
        if (total) job.total = Number(total) || job.total;
        if (label) job.stepLabel = String(label);
        emit(job);
    };
}

async function runJob(job, worker) {
    try {
        const result = await worker(job);
        if (job.controller.signal.aborted || job.status === 'stopped') {
            return finishJob(job, { status: 'stopped', error: 'Stopped.' });
        }
        return finishJob(job, { status: 'done', result });
    } catch (error) {
        if (isAbortError(error) || job.controller.signal.aborted) {
            return finishJob(job, { status: 'stopped', error: 'Stopped.' });
        }
        const entry = await logError(error, {
            source: `${job.kind}-job`,
            jobId: job.id,
            label: job.label,
            output: job.text || job.reasoning || '',
            extra: job.meta || {},
        });
        if (entry?.title) job.logTitle = entry.title;
        return finishJob(job, { status: 'error', error: error.message || String(error) });
    }
}

export function startGenerateJob({ type = 'character', concept, extra = '', creativity, detail = 'standard', includeLorebook = false } = {}) {
    const job = createJob({
        kind: 'generate',
        label: type === 'lorebook' ? 'Drafting lorebook' : type === 'persona' ? 'Drafting persona' : 'Drafting character',
        meta: { type, concept, extra, creativity, detail, includeLorebook },
    });

    runJob(job, async (current) => {
        const options = {
            concept,
            extra,
            creativity,
            detail,
            includeLorebook,
            signal: current.controller.signal,
            onChunk: attachStream(current),
        };
        if (type === 'lorebook') return generateLorebook(options);
        if (type === 'persona') return generatePersona(options);
        return generateCharacter(options);
    });

    return job;
}

export function startRemakeJob({ card, extra = '', critique = '', creativity, detail = 'standard', includeLorebook = true } = {}) {
    const job = createJob({
        kind: 'remake',
        label: `Remaking ${card?.name || 'card'}`,
        meta: { extra, critique, creativity, detail, includeLorebook, name: card?.name || '' },
    });

    runJob(job, async (current) => remakeCharacter({
        cardText: flattenCardForPrompt(card),
        extra,
        critique,
        creativity,
        detail,
        includeLorebook,
        concept: [
            card?.name ? `Character: ${card.name}` : '',
            extra || '',
        ].filter(Boolean).join('\n') || card?.name || '',
        signal: current.controller.signal,
        onChunk: attachStream(current),
    }));

    return job;
}

export function startAnalyzeJob({ card, threshold = 55 } = {}) {
    const job = createJob({
        kind: 'analyze',
        label: `Judging ${card?.name || 'card'}`,
        meta: { threshold, name: card?.name || '' },
    });

    runJob(job, async (current) => {
        const judgement = await gradeCardWithAi(flattenCardForPrompt(card), {
            signal: current.controller.signal,
            onChunk: attachStream(current),
        });
        return normalizeAiJudgement(judgement, { threshold });
    });

    return job;
}
