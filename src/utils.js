export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function uniqueStrings(list) {
    return [...new Set((list || []).map((item) => String(item || '').trim()).filter(Boolean))];
}

export function wordCount(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function charCount(text) {
    return String(text || '').length;
}

export function countOccurrences(haystack, needle) {
    if (!haystack || !needle) return 0;
    const source = String(haystack).toLowerCase();
    const target = String(needle).toLowerCase();
    let count = 0;
    let index = 0;
    while ((index = source.indexOf(target, index)) !== -1) {
        count += 1;
        index += target.length;
    }
    return count;
}

export function extractJsonObject(text) {
    if (!text) throw new Error('Empty model response.');
    const raw = String(text).trim();

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : raw;

    try {
        return JSON.parse(candidate);
    } catch (_) {
        /* Fall through and try to slice the first object/array. */
    }

    const objectStart = candidate.indexOf('{');
    const arrayStart = candidate.indexOf('[');
    const start = [objectStart, arrayStart].filter((n) => n >= 0).sort((a, b) => a - b)[0];
    if (start === undefined) {
        throw new Error('Could not find JSON in the model response.');
    }

    const opening = candidate[start];
    const closing = opening === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < candidate.length; i++) {
        const ch = candidate[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === opening) depth += 1;
        if (ch === closing) depth -= 1;
        if (depth === 0) {
            const slice = candidate.slice(start, i + 1);
            return JSON.parse(slice);
        }
    }

    throw new Error('Model response contained incomplete JSON.');
}

export function downloadTextFile(filename, content, mime = 'application/json') {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read file.'));
        reader.readAsText(file);
    });
}

export function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image.'));
        reader.readAsDataURL(file);
    });
}

/**
 * Reads a SillyTavern / TavernAI PNG character card (tEXt "chara" chunk).
 */
export async function readPngCard(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const pngSig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < pngSig.length; i++) {
        if (bytes[i] !== pngSig[i]) {
            throw new Error('File is not a PNG character card.');
        }
    }

    const decoder = new TextDecoder('latin1');
    let offset = 8;
    while (offset + 8 <= bytes.length) {
        const length = readUint32(bytes, offset);
        const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd > bytes.length) break;

        if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
            const keywordEnd = bytes.indexOf(0, dataStart);
            if (keywordEnd > dataStart) {
                const keyword = decoder.decode(bytes.subarray(dataStart, keywordEnd));
                if (keyword === 'chara' || keyword === 'ccv3') {
                    let payload = bytes.subarray(keywordEnd + 1, dataEnd);
                    if (type === 'zTXt') {
                        const method = payload[0];
                        if (method !== 0) {
                            throw new Error('Unsupported PNG compression method. Export the card as JSON instead.');
                        }
                        payload = await inflateBytes(payload.subarray(1));
                    }
                    if (type === 'iTXt') {
                        // iTXt: keyword\0 compressionFlag compressionMethod language\0 translated\0 text
                        payload = bytes.subarray(keywordEnd + 1, dataEnd);
                        const compressionFlag = payload[0];
                        const method = payload[1];
                        let cursor = 2;
                        while (cursor < payload.length && payload[cursor] !== 0) cursor += 1;
                        cursor += 1;
                        while (cursor < payload.length && payload[cursor] !== 0) cursor += 1;
                        payload = payload.subarray(cursor + 1);
                        if (compressionFlag) {
                            if (method !== 0) {
                                throw new Error('Unsupported PNG compression method. Export the card as JSON instead.');
                            }
                            payload = await inflateBytes(payload);
                        }
                    }
                    const b64 = new TextDecoder('utf-8').decode(payload);
                    const json = atob(b64);
                    return JSON.parse(json);
                }
            }
        }

        if (type === 'IEND') break;
        offset = dataEnd + 4;
    }

    throw new Error('No character data found in this PNG.');
}

function readUint32(bytes, offset) {
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

async function inflateBytes(bytes) {
    if (typeof DecompressionStream !== 'function') {
        throw new Error('This browser cannot inflate compressed PNG card chunks. Export the card as JSON instead.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
}

export function sanitizeFileName(name) {
    return String(name || 'untitled').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim() || 'untitled';
}

export function nowStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function creativityLabel(value) {
    if (value <= 20) return 'Strict / faithful';
    if (value <= 40) return 'Grounded';
    if (value <= 60) return 'Balanced';
    if (value <= 80) return 'Inventive';
    return 'Wild';
}

export function slopBand(score) {
    if (score < 25) return { id: 'clean', label: 'Clean', hint: 'Reads like a crafted card.' };
    if (score < 45) return { id: 'okay', label: 'Okay', hint: 'Usable, with a few lazy spots.' };
    if (score < 65) return { id: 'sloppy', label: 'Sloppy', hint: 'Generic tropes and weak structure.' };
    if (score < 80) return { id: 'slop', label: 'Slop', hint: 'Heavy cliche, filler, or incomplete fields.' };
    return { id: 'toxic', label: 'Toxic slop', hint: 'This card is mostly sludge.' };
}

export function toast(type, message, title = 'Card Crafter') {
    if (typeof toastr === 'undefined') {
        console[type === 'error' ? 'error' : 'log'](`[${title}] ${message}`);
        return;
    }
    const fn = toastr[type] || toastr.info;
    fn(message, title);
}

export function setBusy(button, busy, busyText = 'Working…') {
    if (!button) return;
    if (busy) {
        button.dataset.originalHtml = button.innerHTML;
        button.disabled = true;
        button.classList.add('disabled');
        button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>${escapeHtml(busyText)}</span>`;
    } else {
        button.disabled = false;
        button.classList.remove('disabled');
        if (button.dataset.originalHtml) {
            button.innerHTML = button.dataset.originalHtml;
        }
    }
}
