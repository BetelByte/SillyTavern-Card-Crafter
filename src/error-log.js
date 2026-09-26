import { VERSION } from './constants.js';
import { getContext, getSettings, saveSettings } from './settings.js';

export const ERROR_LOG_DIR = 'user/files';
export const ERROR_LOG_SCAN_HINT = 'SillyTavern/data/<user>/user/files/ERROR_LOG_*.txt and extensionSettings.cardCrafter.errorLogs';

const MAX_LOGS = 40;
const MAX_TEXT = 6000;
const MAX_STACK = 8000;

let writeQueue = Promise.resolve();

function pad(value) {
    return String(value).padStart(2, '0');
}

function stampParts(date = new Date()) {
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return {
        date: `${day}/${month}/${year}`,
        time: `${hours}:${minutes}:${seconds}`,
        fileDate: `${day}-${month}-${year}`,
        fileTime: `${hours}-${minutes}-${seconds}`,
        iso: date.toISOString(),
    };
}

function clip(value, max = MAX_TEXT) {
    const text = String(value ?? '');
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

function serializeError(error) {
    if (error == null) {
        return { message: 'Unknown error', name: 'Error', stack: '', cause: '' };
    }
    if (typeof error === 'string') {
        return { message: error, name: 'Error', stack: '', cause: '' };
    }
    const cause = error.cause
        ? (error.cause instanceof Error ? `${error.cause.name}: ${error.cause.message}` : String(error.cause))
        : '';
    return {
        name: error.name || 'Error',
        message: error.message || String(error),
        stack: clip(error.stack || '', MAX_STACK),
        cause,
    };
}

function nextNumber(settings) {
    const current = Number(settings.errorLogSeq) || 0;
    const next = current + 1;
    settings.errorLogSeq = next;
    return next;
}

function makeNames(number, when) {
    const title = `[ERROR LOG] (${number}) [${when.date}] [${when.time}]`;
    const file = `ERROR_LOG_${number}_${when.fileDate}_${when.fileTime}.txt`;
    return { title, file };
}

function buildBody({ title, level, source, error, context, when }) {
    const lines = [
        title,
        `Level: ${level}`,
        `Source: ${source || 'card-crafter'}`,
        `When: ${when.iso}`,
        `Extension: Card Crafter v${VERSION}`,
        `Page: ${typeof location !== 'undefined' ? location.href : ''}`,
        '',
        `Name: ${error.name}`,
        `Message: ${error.message}`,
    ];
    if (error.cause) {
        lines.push(`Cause: ${error.cause}`);
    }
    if (error.stack) {
        lines.push('', 'Stack:', error.stack);
    }
    if (context && Object.keys(context).length) {
        lines.push('', 'Context:');
        try {
            lines.push(clip(JSON.stringify(context, null, 2), MAX_TEXT));
        } catch (_) {
            lines.push(clip(String(context)));
        }
    }
    return `${lines.join('\n')}\n`;
}

function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
}

async function writeLogFile(filename, body) {
    const ctx = getContext();
    if (typeof ctx.getRequestHeaders !== 'function') {
        throw new Error('SillyTavern file API is unavailable.');
    }
    const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: ctx.getRequestHeaders(),
        body: JSON.stringify({
            name: filename,
            data: toBase64(body),
        }),
    });
    if (!response.ok) {
        throw new Error((await response.text()) || `File upload failed (${response.status}).`);
    }
    const payload = await response.json();
    return payload?.path || `${ERROR_LOG_DIR}/${filename}`;
}

function rememberEntry(settings, entry) {
    const logs = Array.isArray(settings.errorLogs) ? settings.errorLogs : [];
    logs.push(entry);
    settings.errorLogs = logs.slice(-MAX_LOGS);
    saveSettings();
}

async function persist(level, rawError, context = {}) {
    const settings = getSettings();
    if (!Array.isArray(settings.errorLogs)) settings.errorLogs = [];
    const when = stampParts();
    const number = nextNumber(settings);
    const { title, file } = makeNames(number, when);
    const error = serializeError(rawError);
    const safeContext = {
        source: context.source || '',
        jobId: context.jobId || '',
        label: context.label || '',
        output: clip(context.output || ''),
        extra: context.extra || undefined,
    };
    const body = buildBody({
        title,
        level,
        source: context.source || 'card-crafter',
        error,
        context: safeContext,
        when,
    });

    let path = '';
    let writeError = '';
    try {
        path = await writeLogFile(file, body);
    } catch (failure) {
        writeError = failure?.message || String(failure);
        console.warn('[Card Crafter] Could not write error log file.', failure);
    }

    const entry = {
        number,
        title,
        file,
        path,
        level,
        source: context.source || 'card-crafter',
        message: error.message,
        stack: error.stack,
        output: safeContext.output,
        writeError,
        when: when.iso,
    };
    rememberEntry(settings, entry);
    return entry;
}

function enqueue(level, error, context) {
    const task = writeQueue.then(() => persist(level, error, context));
    writeQueue = task.catch((failure) => {
        console.warn('[Card Crafter] Error logger failed.', failure);
        return null;
    });
    return writeQueue;
}

export function logError(error, context = {}) {
    console.error(`[Card Crafter] ${context.source || 'error'}`, error);
    return enqueue('error', error, context);
}

export function logWarn(error, context = {}) {
    console.warn(`[Card Crafter] ${context.source || 'warning'}`, error);
    return enqueue('warn', error, context);
}

export async function reportError(error, context = {}) {
    const { toast } = await import('./utils.js');
    const entry = await logError(error, context);
    const message = error?.message || String(error);
    toast('error', entry?.title ? `${message}  ·  ${entry.title}` : message);
    return entry;
}

export function listErrorLogs() {
    const settings = getSettings();
    return Array.isArray(settings.errorLogs) ? settings.errorLogs : [];
}

export function latestErrorLog() {
    const logs = listErrorLogs();
    return logs.at(-1) || null;
}
