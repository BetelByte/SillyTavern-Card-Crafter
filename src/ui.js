import { DISPLAY_NAME, EXTENSION_NAME, GENERATION_TYPES, TABS, VERSION } from './constants.js';
import {
    generateCharacter,
    generateLorebook,
    generatePersona,
    gradeCardWithAi,
    remakeCharacter,
} from './generate.js';
import {
    buildCharacterCardJson,
    describeImport,
    importCharacterToSillyTavern,
    importLorebookToSillyTavern,
    importPersonaToSillyTavern,
    parseImportedCard,
    toCharacterPayload,
    toLorebookPayload,
    toPersonaPayload,
} from './importers.js';
import { getConnectionProfiles, getSettings, updateSetting } from './settings.js';
import { analyzeSlop, flattenCardForPrompt, normalizeCard } from './slop.js';
import {
    creativityLabel,
    downloadTextFile,
    escapeHtml,
    nowStamp,
    readFileAsText,
    readPngCard,
    sanitizeFileName,
    setBusy,
    slopBand,
    toast,
    wordCount,
} from './utils.js';

const state = {
    tab: 'generate',
    genType: 'character',
    lastConcept: '',
    lastResult: null,
    lastKind: null,
    uploadedCard: null,
    uploadedName: '',
    analysis: null,
    remakeResult: null,
    popup: null,
    opening: false,
};

export function openCardCrafter(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (state.opening || state.popup) return;
    if (document.getElementById('card-crafter-root')) return;

    state.opening = true;
    // Wait out the originating tap so it cannot immediately dismiss the dialog.
    window.setTimeout(() => {
        try {
            openWithPopup();
        } catch (error) {
            state.opening = false;
            console.error('[Card Crafter] Failed to open panel', error);
            toast('error', error.message || 'Could not open Card Crafter.');
        }
    }, 30);
}

function openWithPopup() {
    const ctx = SillyTavern.getContext();
    const root = document.createElement('div');
    root.id = 'card-crafter-root';
    root.className = 'card-crafter-popup';
    root.innerHTML = renderShell();
    bindShell(root);
    renderTab(root);

    if (ctx?.Popup && ctx.POPUP_TYPE) {
        const popup = new ctx.Popup(root, ctx.POPUP_TYPE.DISPLAY, '', {
            large: true,
            wide: true,
            allowVerticalScrolling: true,
            leftAlign: true,
            animation: 'fast',
            onClose: () => {
                state.popup = null;
                state.opening = false;
            },
        });
        state.popup = popup;
        popup.show().catch((error) => {
            state.popup = null;
            state.opening = false;
            console.error('[Card Crafter] Popup failed', error);
            toast('error', error.message || 'Could not open Card Crafter.');
        });
        return;
    }

    openFallback(root);
    state.opening = false;
}

function openFallback(root) {
    root.classList.add('card-crafter-root', 'is-open');
    const host = document.body;
    host.appendChild(root);
    bindShell(root);
    renderTab(root);
    document.addEventListener('keydown', onEscape);
}

export function closeCardCrafter() {
    if (state.popup) {
        state.popup.completeCancelled?.() || state.popup.dlg?.close?.();
        state.popup = null;
        state.opening = false;
        return;
    }
    const root = document.getElementById('card-crafter-root');
    if (!root) return;
    document.removeEventListener('keydown', onEscape);
    root.classList.remove('is-open');
    root.remove();
}

function renderShell() {
    const settings = getSettings();
    return `
    <section class="card-crafter-panel" role="dialog" aria-label="Card Crafter">
      <header class="card-crafter-header">
        <div class="card-crafter-heading">
          <div class="card-crafter-mark" aria-hidden="true"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
          <div>
            <h2 id="cc-title">${DISPLAY_NAME}</h2>
            <p>Describe a concept. Get a card, lorebook, or persona.</p>
          </div>
        </div>
        <button type="button" class="card-crafter-icon-btn" data-cc-close title="Close" aria-label="Close">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </header>
      <nav class="card-crafter-tabs" role="tablist">
        ${TABS.map((tab) => `
          <button type="button" class="card-crafter-tab${tab.id === state.tab ? ' is-active' : ''}" data-cc-tab="${tab.id}" role="tab" aria-selected="${tab.id === state.tab}">
            <i class="fa-solid ${tab.icon}"></i>
            <span>${tab.label}</span>
          </button>
        `).join('')}
      </nav>
      <div class="card-crafter-body" id="cc-body"></div>
      <footer class="card-crafter-footer">
        <span>v${VERSION}</span>
        <span>${settings.compactMobile ? 'Mobile layout' : 'Desktop layout'}</span>
      </footer>
    </section>
  `;
}

function bindShell(root) {
    root.querySelectorAll('[data-cc-close]').forEach((el) => {
        el.addEventListener('click', closeCardCrafter);
    });
    root.querySelectorAll('[data-cc-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
            state.tab = btn.dataset.ccTab;
            root.querySelectorAll('[data-cc-tab]').forEach((other) => {
                other.classList.toggle('is-active', other === btn);
                other.setAttribute('aria-selected', other === btn ? 'true' : 'false');
            });
            renderTab(root);
        });
    });
    document.addEventListener('keydown', onEscape);
}

function onEscape(event) {
    if (event.key !== 'Escape') return;
    if (!document.getElementById('card-crafter-root')) return;
    closeCardCrafter();
}

function renderTab(root) {
    const body = root.querySelector('#cc-body');
    if (!body) return;
    if (state.tab === 'generate') body.innerHTML = renderGenerate();
    if (state.tab === 'analyze') body.innerHTML = renderAnalyze();
    if (state.tab === 'remediate') body.innerHTML = renderRemake();
    if (state.tab === 'settings') body.innerHTML = renderSettings();
    bindTab(root);
}

function renderGenerate() {
    const settings = getSettings();
    return `
    <form class="card-crafter-form" id="cc-generate-form">
      <div class="card-crafter-type-row">
        ${GENERATION_TYPES.map((type) => `
          <label class="card-crafter-chip${state.genType === type.id ? ' is-active' : ''}">
            <input type="radio" name="cc-type" value="${type.id}" ${state.genType === type.id ? 'checked' : ''}>
            <strong>${type.label}</strong>
            <span>${type.hint}</span>
          </label>
        `).join('')}
      </div>
      <label class="card-crafter-field">
        <span>Concept</span>
        <textarea id="cc-concept" rows="7" required placeholder="A tired night-shift archivist in a flooded library-city who bargains for lost names…">${escapeHtml(state.lastConcept || '')}</textarea>
      </label>
      <label class="card-crafter-field">
        <span>Extra direction <em>optional</em></span>
        <textarea id="cc-extra" rows="3" placeholder="Must include a living lighthouse. No romance. Keep the prose dry."></textarea>
      </label>
      <label class="card-crafter-field">
        <span>Creativity <strong id="cc-creativity-label">${settings.defaultCreativity} · ${creativityLabel(settings.defaultCreativity)}</strong></span>
        <input type="range" id="cc-creativity" min="0" max="100" step="5" value="${settings.defaultCreativity}">
      </label>
      <label class="card-crafter-check" id="cc-lore-wrap">
        <input type="checkbox" id="cc-include-lore" ${settings.autoImportLorebook ? 'checked' : ''}>
        <span>Also draft a lorebook if the character needs one</span>
      </label>
      <div class="card-crafter-actions">
        <button type="submit" class="card-crafter-primary" id="cc-generate-btn">
          <i class="fa-solid fa-bolt"></i>
          <span>Generate</span>
        </button>
      </div>
    </form>
    <div id="cc-generate-result">${state.lastResult ? renderResult(state.lastResult, state.lastKind) : ''}</div>
  `;
}

function renderAnalyze() {
    return `
    <div class="card-crafter-form">
      <p class="card-crafter-lead">Upload a PNG character card or a JSON dump. The slop-o-meter scores formatting, completeness, cliches, and filler. Higher is sloppier.</p>
      <label class="card-crafter-drop" id="cc-drop">
        <input type="file" id="cc-file" accept=".png,.json,application/json,image/png">
        <i class="fa-solid fa-file-arrow-up"></i>
        <strong>${state.uploadedName || 'Drop a card here'}</strong>
        <span>PNG tavern card or JSON</span>
      </label>
      <label class="card-crafter-field">
        <span>Or paste JSON</span>
        <textarea id="cc-paste" rows="6" placeholder='{"spec":"chara_card_v2", ...}'></textarea>
      </label>
      <div class="card-crafter-actions">
        <button type="button" class="card-crafter-primary" id="cc-analyze-btn">
          <i class="fa-solid fa-gauge-high"></i>
          <span>Run slop-o-meter</span>
        </button>
      </div>
    </div>
    <div id="cc-analyze-result">${state.analysis ? renderAnalysis(state.analysis, state.uploadedCard) : ''}</div>
  `;
}

function renderRemake() {
    const settings = getSettings();
    const ready = Boolean(state.uploadedCard);
    return `
    <div class="card-crafter-form">
      <p class="card-crafter-lead">Remake the uploaded card with a cleaner format, optional lorebook, and your creativity slider. Analyze a card first, or upload one here.</p>
      <label class="card-crafter-drop" id="cc-remake-drop">
        <input type="file" id="cc-remake-file" accept=".png,.json,application/json,image/png">
        <i class="fa-solid fa-recycle"></i>
        <strong>${state.uploadedName || 'Upload the sloppy card'}</strong>
        <span>${ready ? 'Ready to remake' : 'PNG or JSON'}</span>
      </label>
      <label class="card-crafter-field">
        <span>Remake direction <em>optional</em></span>
        <textarea id="cc-remake-extra" rows="3" placeholder="Keep the name. Cut the harem bait. Make her a competent cartographer."></textarea>
      </label>
      <label class="card-crafter-field">
        <span>Creativity <strong id="cc-remake-creativity-label">${settings.defaultCreativity} · ${creativityLabel(settings.defaultCreativity)}</strong></span>
        <input type="range" id="cc-remake-creativity" min="0" max="100" step="5" value="${settings.defaultCreativity}">
      </label>
      <label class="card-crafter-check">
        <input type="checkbox" id="cc-remake-lore" checked>
        <span>Build a lorebook if the remake needs one</span>
      </label>
      <div class="card-crafter-actions">
        <button type="button" class="card-crafter-primary" id="cc-remake-btn" ${ready ? '' : 'disabled'}>
          <i class="fa-solid fa-screwdriver-wrench"></i>
          <span>Remake card</span>
        </button>
      </div>
    </div>
    <div id="cc-remake-result">${state.remakeResult ? renderResult(state.remakeResult, 'character') : ''}</div>
  `;
}

function renderSettings() {
    const settings = getSettings();
    const profiles = getConnectionProfiles();
    return `
    <form class="card-crafter-form" id="cc-settings-form">
      <label class="card-crafter-field">
        <span>Connection profile</span>
        <select id="cc-profile">
          <option value="">Use SillyTavern's current API</option>
          ${profiles.map((p) => `<option value="${escapeHtml(p.id)}" ${settings.profileId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
        </select>
        <small>Connection Manager profiles are preferred. Otherwise Card Crafter uses whatever model you already have selected.</small>
      </label>
      <label class="card-crafter-field">
        <span>Creator name stamped on new cards</span>
        <input type="text" id="cc-creator" value="${escapeHtml(settings.creatorName || '')}" placeholder="your name or handle">
      </label>
      <label class="card-crafter-field">
        <span>Slop threshold <strong id="cc-threshold-label">${settings.slopThreshold}</strong></span>
        <input type="range" id="cc-threshold" min="20" max="90" step="5" value="${settings.slopThreshold}">
        <small>Cards at or above this score are flagged as slop.</small>
      </label>
      <label class="card-crafter-field">
        <span>Default creativity <strong id="cc-default-creativity-label">${settings.defaultCreativity} · ${creativityLabel(settings.defaultCreativity)}</strong></span>
        <input type="range" id="cc-default-creativity" min="0" max="100" step="5" value="${settings.defaultCreativity}">
      </label>
      <label class="card-crafter-field">
        <span>Max response tokens</span>
        <input type="number" id="cc-max-tokens" min="800" max="8000" step="100" value="${settings.maxResponseTokens}">
      </label>
      <label class="card-crafter-check">
        <input type="checkbox" id="cc-ai-slop" ${settings.enableAiSlopAnalysis ? 'checked' : ''}>
        <span>Blend in an extra AI judge when analyzing (slower, uses tokens)</span>
      </label>
      <label class="card-crafter-check">
        <input type="checkbox" id="cc-auto-lore" ${settings.autoImportLorebook ? 'checked' : ''}>
        <span>Default to drafting a lorebook with characters</span>
      </label>
      <div class="card-crafter-actions">
        <button type="submit" class="card-crafter-primary">
          <i class="fa-solid fa-floppy-disk"></i>
          <span>Save settings</span>
        </button>
      </div>
      <p class="card-crafter-muted">Repo: <code>https://github.com/BetelByte/${EXTENSION_NAME}</code></p>
    </form>
  `;
}

function renderResult(raw, kind) {
    if (kind === 'lorebook') return renderLorebookResult(raw);
    if (kind === 'persona') return renderPersonaResult(raw);
    return renderCharacterResult(raw);
}

function renderCharacterResult(raw) {
    const payload = toCharacterPayload(raw);
    const analysis = analyzeSlop(payload, { threshold: getSettings().slopThreshold });
    const band = slopBand(analysis.score);
    const loreCount = (payload.lorebook || []).length;
    return `
    <article class="card-crafter-result">
      <header class="card-crafter-result-head">
        <div>
          <h3>${escapeHtml(payload.name)}</h3>
          <p>${wordCount(payload.description)}w description · ${wordCount(payload.first_mes)}w greeting${loreCount ? ` · ${loreCount} lore entries` : ''}</p>
        </div>
        ${renderMeter(analysis.score, band)}
      </header>
      ${renderFieldPreview('Description', payload.description)}
      ${renderFieldPreview('Personality', payload.personality)}
      ${renderFieldPreview('Scenario', payload.scenario)}
      ${renderFieldPreview('First message', payload.first_mes)}
      ${payload.mes_example ? renderFieldPreview('Examples', payload.mes_example) : ''}
      ${loreCount ? `<p class="card-crafter-muted">${loreCount} lorebook entries drafted with this card.</p>` : ''}
      <div class="card-crafter-actions wrap">
        <button type="button" class="card-crafter-primary" data-cc-import-char>
          <i class="fa-solid fa-file-import"></i><span>Import character</span>
        </button>
        ${loreCount ? `<button type="button" class="card-crafter-secondary" data-cc-import-char-lore><i class="fa-solid fa-book"></i><span>Import + lorebook</span></button>` : ''}
        <button type="button" class="card-crafter-ghost" data-cc-download-char>
          <i class="fa-solid fa-download"></i><span>Download JSON</span>
        </button>
      </div>
    </article>
  `;
}

function renderLorebookResult(raw) {
    const book = toLorebookPayload(raw);
    return `
    <article class="card-crafter-result">
      <header class="card-crafter-result-head">
        <div>
          <h3>${escapeHtml(book.name || 'Lorebook')}</h3>
          <p>${book.entries.length} entries${book.description ? ` · ${escapeHtml(book.description)}` : ''}</p>
        </div>
      </header>
      <ul class="card-crafter-entry-list">
        ${book.entries.map((entry) => `
          <li>
            <strong>${escapeHtml(entry.comment || 'Entry')}</strong>
            <span>${escapeHtml((entry.keys || []).join(', '))}</span>
            <p>${escapeHtml(entry.content || '')}</p>
          </li>
        `).join('')}
      </ul>
      <div class="card-crafter-actions wrap">
        <button type="button" class="card-crafter-primary" data-cc-import-lore>
          <i class="fa-solid fa-file-import"></i><span>Import lorebook</span>
        </button>
        <button type="button" class="card-crafter-ghost" data-cc-download-lore>
          <i class="fa-solid fa-download"></i><span>Download JSON</span>
        </button>
      </div>
    </article>
  `;
}

function renderPersonaResult(raw) {
    const persona = toPersonaPayload(raw);
    return `
    <article class="card-crafter-result">
      <header class="card-crafter-result-head">
        <div>
          <h3>${escapeHtml(persona.name)}</h3>
          <p>${persona.title ? escapeHtml(persona.title) + ' · ' : ''}${wordCount(persona.description)}w</p>
        </div>
      </header>
      ${renderFieldPreview('Persona', persona.description)}
      <div class="card-crafter-actions wrap">
        <button type="button" class="card-crafter-primary" data-cc-import-persona>
          <i class="fa-solid fa-file-import"></i><span>Import persona</span>
        </button>
        <button type="button" class="card-crafter-ghost" data-cc-download-persona>
          <i class="fa-solid fa-download"></i><span>Download JSON</span>
        </button>
      </div>
    </article>
  `;
}

function renderFieldPreview(label, text) {
    const short = String(text || '').trim();
    if (!short) return '';
    const collapsed = short.length > 280 ? `${short.slice(0, 280).trim()}…` : short;
    return `
    <details class="card-crafter-preview" ${short.length < 280 ? 'open' : ''}>
      <summary>${escapeHtml(label)}</summary>
      <p>${escapeHtml(short.length > 280 ? short : collapsed)}</p>
    </details>
  `;
}

function renderMeter(score, band) {
    return `
    <div class="card-crafter-meter band-${band.id}" title="${escapeHtml(band.hint)}">
      <span class="card-crafter-meter-score">${score}</span>
      <span class="card-crafter-meter-label">${escapeHtml(band.label)}</span>
    </div>
  `;
}

function renderAnalysis(analysis, card) {
    const data = normalizeCard(card) || {};
    const band = slopBand(analysis.score);
    return `
    <article class="card-crafter-result">
      <header class="card-crafter-result-head">
        <div>
          <h3>${escapeHtml(data.name || state.uploadedName || 'Uploaded card')}</h3>
          <p>${analysis.isSlop ? 'Flagged as slop' : 'Below the slop line'} · threshold ${getSettings().slopThreshold}</p>
        </div>
        ${renderMeter(analysis.score, band)}
      </header>
      <p class="card-crafter-lead">${escapeHtml(band.hint)}</p>
      <div class="card-crafter-bars">
        ${renderBar('Cliches', analysis.breakdown.creativity)}
        ${renderBar('Completeness', analysis.breakdown.completeness)}
        ${renderBar('Formatting', analysis.breakdown.formatting)}
        ${renderBar('Repetition', analysis.breakdown.repetition)}
        ${renderBar('Bloat', analysis.breakdown.tokenEfficiency)}
      </div>
      ${analysis.aiSummary ? `<p class="card-crafter-lead">${escapeHtml(analysis.aiSummary)}</p>` : ''}
      <ul class="card-crafter-issues">
        ${analysis.issues.map((issue) => `
          <li class="sev-${issue.severity}">
            <strong>${escapeHtml(issue.type)}</strong>
            <span>${escapeHtml(issue.description)}</span>
            <em>${escapeHtml(issue.suggestion)}</em>
          </li>
        `).join('')}
      </ul>
      <div class="card-crafter-recs">
        ${analysis.recommendations.map((rec) => `<p>${escapeHtml(rec)}</p>`).join('')}
      </div>
      <div class="card-crafter-actions">
        <button type="button" class="card-crafter-primary" data-cc-goto-remake>
          <i class="fa-solid fa-screwdriver-wrench"></i><span>Remake this card</span>
        </button>
      </div>
    </article>
  `;
}

function renderBar(label, value) {
    return `
    <div class="card-crafter-bar">
      <span>${escapeHtml(label)}</span>
      <div class="card-crafter-bar-track"><i style="width:${Math.max(4, value)}%"></i></div>
      <b>${value}</b>
    </div>
  `;
}

function bindTab(root) {
    bindShared(root);
    if (state.tab === 'generate') bindGenerate(root);
    if (state.tab === 'analyze') bindAnalyze(root);
    if (state.tab === 'remediate') bindRemake(root);
    if (state.tab === 'settings') bindSettings(root);
}

function bindShared(root) {
    root.querySelector('[data-cc-goto-remake]')?.addEventListener('click', () => {
        state.tab = 'remediate';
        root.querySelectorAll('[data-cc-tab]').forEach((btn) => {
            const active = btn.dataset.ccTab === 'remediate';
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        renderTab(root);
    });

    root.querySelector('[data-cc-import-char]')?.addEventListener('click', async (event) => {
        await handleCharacterImport(event.currentTarget, false);
    });
    root.querySelector('[data-cc-import-char-lore]')?.addEventListener('click', async (event) => {
        await handleCharacterImport(event.currentTarget, true);
    });
    root.querySelector('[data-cc-download-char]')?.addEventListener('click', () => {
        const payload = toCharacterPayload(state.lastKind === 'character' ? state.lastResult : state.remakeResult);
        const json = buildCharacterCardJson(payload);
        downloadTextFile(`${sanitizeFileName(payload.name)}.json`, JSON.stringify(json, null, 2));
    });
    root.querySelector('[data-cc-import-lore]')?.addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        try {
            setBusy(btn, true, 'Importing…');
            const book = toLorebookPayload(state.lastResult);
            const name = await importLorebookToSillyTavern(book);
            describeImport('Lorebook', name);
        } catch (error) {
            toast('error', error.message || String(error));
        } finally {
            setBusy(btn, false);
        }
    });
    root.querySelector('[data-cc-download-lore]')?.addEventListener('click', () => {
        const book = toLorebookPayload(state.lastResult);
        downloadTextFile(`${sanitizeFileName(book.name || 'lorebook')}.json`, JSON.stringify(book, null, 2));
    });
    root.querySelector('[data-cc-import-persona]')?.addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        try {
            setBusy(btn, true, 'Importing…');
            const persona = toPersonaPayload(state.lastResult);
            await importPersonaToSillyTavern(persona);
            describeImport('Persona', persona.name);
        } catch (error) {
            toast('error', error.message || String(error));
        } finally {
            setBusy(btn, false);
        }
    });
    root.querySelector('[data-cc-download-persona]')?.addEventListener('click', () => {
        const persona = toPersonaPayload(state.lastResult);
        downloadTextFile(`${sanitizeFileName(persona.name)}-persona.json`, JSON.stringify(persona, null, 2));
    });
}

async function handleCharacterImport(btn, withLore) {
    const raw = state.tab === 'remediate' ? state.remakeResult : state.lastResult;
    const payload = toCharacterPayload(raw);
    try {
        setBusy(btn, true, 'Importing…');
        let worldName = '';
        if (withLore && payload.lorebook?.length) {
            worldName = await importLorebookToSillyTavern(payload.lorebook, `${payload.name} Lore`);
        }
        await importCharacterToSillyTavern(payload, { worldName });
        describeImport('Character', payload.name);
    } catch (error) {
        toast('error', error.message || String(error));
    } finally {
        setBusy(btn, false);
    }
}

function bindGenerate(root) {
    const loreWrap = root.querySelector('#cc-lore-wrap');
    const updateType = () => {
        state.genType = root.querySelector('input[name="cc-type"]:checked')?.value || 'character';
        root.querySelectorAll('.card-crafter-chip').forEach((chip) => {
            chip.classList.toggle('is-active', chip.querySelector('input')?.value === state.genType);
        });
        if (loreWrap) loreWrap.style.display = state.genType === 'character' ? '' : 'none';
    };
    root.querySelectorAll('input[name="cc-type"]').forEach((input) => input.addEventListener('change', updateType));
    updateType();

    const slider = root.querySelector('#cc-creativity');
    const label = root.querySelector('#cc-creativity-label');
    slider?.addEventListener('input', () => {
        label.textContent = `${slider.value} · ${creativityLabel(slider.value)}`;
    });

    root.querySelector('#cc-generate-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const concept = root.querySelector('#cc-concept').value.trim();
        if (!concept) {
            toast('warning', 'Describe the concept first.');
            return;
        }
        const extra = root.querySelector('#cc-extra').value.trim();
        const creativity = Number(slider.value);
        const includeLorebook = Boolean(root.querySelector('#cc-include-lore')?.checked);
        const btn = root.querySelector('#cc-generate-btn');
        state.lastConcept = concept;
        try {
            setBusy(btn, true, 'Crafting…');
            let result;
            if (state.genType === 'lorebook') {
                result = await generateLorebook({ concept, creativity, extra });
            } else if (state.genType === 'persona') {
                result = await generatePersona({ concept, creativity, extra });
            } else {
                result = await generateCharacter({ concept, creativity, extra, includeLorebook });
            }
            state.lastResult = result;
            state.lastKind = state.genType;
            root.querySelector('#cc-generate-result').innerHTML = renderResult(result, state.genType);
            bindShared(root);
            toast('success', `${state.genType} drafted.`);
        } catch (error) {
            console.error(error);
            toast('error', error.message || String(error));
        } finally {
            setBusy(btn, false);
        }
    });
}

function bindAnalyze(root) {
    root.querySelector('#cc-file')?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (file) await ingestCard(file, root);
    });
    root.querySelector('#cc-analyze-btn')?.addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        try {
            const pasted = root.querySelector('#cc-paste').value.trim();
            if (pasted) {
                state.uploadedCard = parseImportedCard(pasted);
                state.uploadedName = state.uploadedCard.name || 'Pasted card';
            }
            if (!state.uploadedCard) {
                toast('warning', 'Upload or paste a card first.');
                return;
            }
            setBusy(btn, true, 'Scoring…');
            const settings = getSettings();
            let ai = null;
            if (settings.enableAiSlopAnalysis) {
                try {
                    ai = await gradeCardWithAi(flattenCardForPrompt(state.uploadedCard));
                } catch (error) {
                    console.warn('[Card Crafter] AI slop pass failed.', error);
                    toast('warning', 'Heuristic score only — AI judge failed.');
                }
            }
            state.analysis = analyzeSlop(state.uploadedCard, { threshold: settings.slopThreshold, ai });
            root.querySelector('#cc-analyze-result').innerHTML = renderAnalysis(state.analysis, state.uploadedCard);
            bindShared(root);
        } catch (error) {
            toast('error', error.message || String(error));
        } finally {
            setBusy(btn, false);
        }
    });
}

function bindRemake(root) {
    const slider = root.querySelector('#cc-remake-creativity');
    const label = root.querySelector('#cc-remake-creativity-label');
    slider?.addEventListener('input', () => {
        label.textContent = `${slider.value} · ${creativityLabel(slider.value)}`;
    });
    root.querySelector('#cc-remake-file')?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (file) {
            await ingestCard(file, root);
            renderTab(root);
        }
    });
    root.querySelector('#cc-remake-btn')?.addEventListener('click', async (event) => {
        if (!state.uploadedCard) {
            toast('warning', 'Upload a card to remake.');
            return;
        }
        const btn = event.currentTarget;
        try {
            setBusy(btn, true, 'Remaking…');
            const result = await remakeCharacter({
                cardText: flattenCardForPrompt(state.uploadedCard),
                creativity: Number(slider.value),
                extra: root.querySelector('#cc-remake-extra').value.trim(),
                includeLorebook: Boolean(root.querySelector('#cc-remake-lore')?.checked),
            });
            state.remakeResult = result;
            state.lastResult = result;
            state.lastKind = 'character';
            root.querySelector('#cc-remake-result').innerHTML = renderResult(result, 'character');
            bindShared(root);
            toast('success', 'Remake ready.');
        } catch (error) {
            toast('error', error.message || String(error));
        } finally {
            setBusy(btn, false);
        }
    });
}

function bindSettings(root) {
    const threshold = root.querySelector('#cc-threshold');
    const thresholdLabel = root.querySelector('#cc-threshold-label');
    threshold?.addEventListener('input', () => {
        thresholdLabel.textContent = threshold.value;
    });
    const creativity = root.querySelector('#cc-default-creativity');
    const creativityLabelEl = root.querySelector('#cc-default-creativity-label');
    creativity?.addEventListener('input', () => {
        creativityLabelEl.textContent = `${creativity.value} · ${creativityLabel(creativity.value)}`;
    });
    root.querySelector('#cc-settings-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        updateSetting('profileId', root.querySelector('#cc-profile').value);
        updateSetting('creatorName', root.querySelector('#cc-creator').value.trim());
        updateSetting('slopThreshold', Number(threshold.value));
        updateSetting('defaultCreativity', Number(creativity.value));
        updateSetting('maxResponseTokens', Number(root.querySelector('#cc-max-tokens').value) || 3500);
        updateSetting('enableAiSlopAnalysis', root.querySelector('#cc-ai-slop').checked);
        updateSetting('autoImportLorebook', root.querySelector('#cc-auto-lore').checked);
        toast('success', 'Settings saved.');
    });
}

async function ingestCard(file, root) {
    try {
        let card;
        if (file.name.toLowerCase().endsWith('.png') || file.type === 'image/png') {
            card = await readPngCard(file);
        } else {
            card = parseImportedCard(await readFileAsText(file));
        }
        state.uploadedCard = card;
        state.uploadedName = card.name || file.name;
        const drop = root.querySelector('.card-crafter-drop strong');
        if (drop) drop.textContent = state.uploadedName;
        toast('info', `Loaded ${state.uploadedName}`);
    } catch (error) {
        toast('error', error.message || String(error));
    }
}
