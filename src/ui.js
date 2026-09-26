import { CHARACTER_FIELD_STEPS, DETAIL_PRESETS, DISPLAY_NAME, EXTENSION_NAME, GENERATION_TYPES, PERSONA_FIELD_STEPS, TABS, VERSION } from './constants.js';
import {
    abortJob,
    getActiveJob,
    getLatestJob,
    startAnalyzeJob,
    startGenerateJob,
    startRemakeJob,
    subscribeJobs,
} from './jobs.js';
import {
    buildCharacterCardJson,
    buildWorldInfoFile,
    describeImport,
    importCharacterToSillyTavern,
    importLorebookToSillyTavern,
    importPersonaToSillyTavern,
    parseImportedCard,
    toCharacterPayload,
    toLorebookPayload,
    toPersonaPayload,
} from './importers.js';
import {
    characterOptionLabel,
    getCurrentCharacterRef,
    listLibraryCharacters,
    loadLibraryCharacter,
} from './characters.js';
import { reportError } from './error-log.js';
import { getConnectionProfiles, getSettings, updateSetting } from './settings.js';
import { formatAnalysisBrief, normalizeCard } from './slop.js';
import {
    creativityLabel,
    detailLabel,
    downloadTextFile,
    escapeHtml,
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
    selectedAvatar: '',
    analysis: null,
    remakeResult: null,
    remakeExtra: '',
    remakeIncludeLore: true,
    remakeCreativity: null,
    lastExtra: '',
    generateIncludeLore: null,
    generateCreativity: null,
    generateDetail: null,
    remakeDetail: null,
    popup: null,
    opening: false,
    dock: null,
    unsubscribeJobs: null,
};

ensureJobBridge();

export function openCardCrafter(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    if (state.opening || state.popup) return;
    if (document.getElementById('card-crafter-root')) return;

    state.opening = true;
    // Wait out the originating tap so it cannot immediately dismiss the dialog.
    window.setTimeout(() => {
        try {
            openWithPopup();
        } catch (error) {
            resetOpenState();
            reportError(error, { source: 'open-panel' });
        }
    }, 50);
}

function ensureJobBridge() {
    if (state.unsubscribeJobs) return;
    state.unsubscribeJobs = subscribeJobs((job) => {
        applyJobToState(job);
        refreshLiveUi(job);
        if (job.status === 'done') notifyJobDone(job);
        if (job.status === 'error') {
            toast('error', job.logTitle ? `${job.error}  ·  ${job.logTitle}` : (job.error || 'Generation failed.'));
        }
        if (job.status === 'stopped') toast('warning', `${job.label} stopped.`);
    });
}

function applyJobToState(job) {
    if (job.status !== 'done' || !job.result) return;
    if (job.kind === 'generate') {
        state.lastResult = job.result;
        state.lastKind = job.meta?.type || 'character';
    }
    if (job.kind === 'remake') {
        state.remakeResult = job.result;
        state.lastResult = job.result;
        state.lastKind = 'character';
    }
    if (job.kind === 'analyze') {
        state.analysis = job.result;
    }
}

function notifyJobDone(job) {
    if (job.kind === 'generate') toast('success', `${job.meta?.type || 'card'} drafted.`);
    if (job.kind === 'remake') toast('success', 'Remake ready.');
    if (job.kind === 'analyze') toast('success', 'Judgement ready.');
}

function refreshLiveUi(job) {
    const root = document.getElementById('card-crafter-root');
    if (root) {
        if (job.status !== 'running') renderTab(root);
        else paintLivePanels(root, job);
    }
    renderDock();
}

function currentPanelRoot() {
    return document.getElementById('card-crafter-root');
}

function resetOpenState() {
    state.popup = null;
    state.opening = false;
    document.removeEventListener('keydown', onEscape);
    renderDock();
}

function openWithPopup() {
    const ctx = SillyTavern.getContext();
    const root = document.createElement('div');
    root.id = 'card-crafter-root';
    root.className = 'card-crafter-popup';
    root.innerHTML = renderShell();
    bindShell(root);
    renderTab(root);

    renderDock();
    if (ctx?.Popup && ctx.POPUP_TYPE) {
        const popup = new ctx.Popup(root, ctx.POPUP_TYPE.DISPLAY, '', {
            large: true,
            wide: true,
            allowVerticalScrolling: true,
            leftAlign: true,
            animation: 'fast',
            onClose: () => {
                resetOpenState();
            },
        });
        state.popup = popup;
        document.addEventListener('keydown', onEscape);
        popup.show().catch((error) => {
            resetOpenState();
            reportError(error, { source: 'popup' });
        });
        return;
    }

    openFallback(root);
}

function openFallback(root) {
    root.classList.add('card-crafter-root', 'is-open');
    document.body.appendChild(root);
    document.addEventListener('keydown', onEscape);
    state.opening = false;
}

export function closeCardCrafter() {
    if (state.popup) {
        const popup = state.popup;
        resetOpenState();
        popup.completeCancelled?.() || popup.dlg?.close?.();
        return;
    }
    const root = document.getElementById('card-crafter-root');
    resetOpenState();
    if (!root) return;
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
}

function onEscape(event) {
    if (event.key !== 'Escape') return;
    if (!document.getElementById('card-crafter-root')) return;
    closeCardCrafter();
}

function switchTab(root, tabId) {
    state.tab = tabId;
    root.querySelectorAll('[data-cc-tab]').forEach((btn) => {
        const active = btn.dataset.ccTab === tabId;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    renderTab(root);
}

async function ensureCardLoaded(root) {
    if (state.uploadedCard) return state.uploadedCard;

    const selected = root.querySelector('.cc-library-select')?.value
        || state.selectedAvatar
        || getCurrentCharacterRef()?.avatar
        || '';
    if (selected) {
        await ingestLibraryCard(selected, root, { quiet: true });
        if (state.uploadedCard) return state.uploadedCard;
    }

    toast('warning', 'Pick a library character or upload a card first.');
    return null;
}

function renderTab(root) {
    const body = root.querySelector('#cc-body');
    if (!body) return;
    if (state.tab === 'generate') body.innerHTML = renderGenerate();
    if (state.tab === 'analyze') body.innerHTML = renderAnalyze();
    if (state.tab === 'remediate') body.innerHTML = renderRemake();
    if (state.tab === 'settings') body.innerHTML = renderSettings();
    bindTab(root);
    paintLivePanels(root);
}

function paintLivePanels(root, job) {
    if (!root) return;
    const generateHost = root.querySelector('#cc-generate-live');
    if (generateHost) generateHost.innerHTML = renderJobPanel(job?.kind === 'generate' ? job : getLatestJob('generate'));
    const analyzeHost = root.querySelector('#cc-analyze-live');
    if (analyzeHost) analyzeHost.innerHTML = renderJobPanel(job?.kind === 'analyze' ? job : getLatestJob('analyze'));
    const remakeHost = root.querySelector('#cc-remake-live');
    if (remakeHost) remakeHost.innerHTML = renderJobPanel(job?.kind === 'remake' ? job : getLatestJob('remake'));
    bindJobControls(root);
    updateActionButtons(root);
    root.querySelectorAll('[data-cc-stream]').forEach((el) => {
        el.scrollTop = el.scrollHeight;
    });
}

function updateActionButtons(root) {
    const active = getActiveJob();
    const generateBtn = root.querySelector('#cc-generate-btn');
    if (generateBtn) {
        const busy = active?.kind === 'generate';
        setBusy(generateBtn, busy, 'Crafting…');
    }
    const analyzeBtn = root.querySelector('#cc-analyze-btn');
    if (analyzeBtn) {
        const busy = active?.kind === 'analyze';
        setBusy(analyzeBtn, busy, 'Asking the model…');
    }
    const remakeBtn = root.querySelector('#cc-remake-btn');
    if (remakeBtn) {
        const busy = active?.kind === 'remake';
        setBusy(remakeBtn, busy, 'Remaking…');
    }
}

function bindJobControls(root) {
    root.querySelectorAll('[data-cc-stop]').forEach((button) => {
        if (button.dataset.ccBound === '1') return;
        button.dataset.ccBound = '1';
        button.addEventListener('click', () => {
            abortJob(button.dataset.ccStop || undefined);
        });
    });
}

function jobStatusLabel(job) {
    if (!job) return '';
    const step = job.step && job.total ? `Step ${job.step}/${job.total}${job.stepLabel ? ` · ${job.stepLabel}` : ''}` : (job.stepLabel || '');
    if (job.status === 'running') {
        if (step) return step;
        return job.fallback ? 'Waiting on the model…' : 'Streaming…';
    }
    if (job.status === 'done') return 'Done';
    if (job.status === 'stopped') return 'Stopped';
    return step ? `Failed · ${step}` : 'Failed';
}

function pipelineStepsFor(job) {
    if (!job) return [];
    if (job.kind === 'analyze') return [{ label: 'Judgement' }];
    if (job.kind === 'generate' && job.meta?.type === 'lorebook') return [{ label: 'Lorebook' }];
    if (job.kind === 'generate' && job.meta?.type === 'persona') {
        return PERSONA_FIELD_STEPS.map((step) => ({ label: step.label }));
    }
    const steps = CHARACTER_FIELD_STEPS.map((step) => ({ label: step.label }));
    if (job.meta?.includeLorebook) steps.push({ label: 'Lorebook' });
    return steps;
}

function renderJobSteps(job) {
    const steps = pipelineStepsFor(job);
    if (!steps.length) return '';
    return `
      <ol class="card-crafter-steps">
        ${steps.map((step, index) => {
            const number = index + 1;
            const current = Number(job.step) || 0;
            const stateClass = job.status === 'done' || current > number
                ? 'is-done'
                : current === number && job.status === 'running'
                    ? 'is-current'
                    : current === number && job.status === 'error'
                        ? 'is-failed'
                        : '';
            return `<li class="${stateClass}"><span>${number}</span>${escapeHtml(step.label)}</li>`;
        }).join('')}
      </ol>
    `;
}

function renderJobPanel(job) {
    if (!job) return '';
    const preview = job.text || job.reasoning || (job.status === 'running' ? 'Waiting for the first tokens…' : '');
    return `
    <article class="card-crafter-job status-${job.status}" data-cc-job="${escapeHtml(job.id)}">
      <header class="card-crafter-job-head">
        <div>
          <strong>${escapeHtml(job.label)}</strong>
          <span>${escapeHtml(jobStatusLabel(job))}</span>
        </div>
        ${job.status === 'running' ? `<button type="button" class="card-crafter-ghost" data-cc-stop="${escapeHtml(job.id)}"><i class="fa-solid fa-stop"></i><span>Stop</span></button>` : ''}
      </header>
      ${renderJobSteps(job)}
      ${job.error && job.status !== 'running' ? `<p class="card-crafter-job-error">${escapeHtml(job.error)}</p>` : ''}
      ${preview ? `<pre class="card-crafter-stream" data-cc-stream>${escapeHtml(preview)}</pre>` : ''}
    </article>
  `;
}

function renderDock() {
    const active = getActiveJob();
    const existing = document.getElementById('card-crafter-dock');
    if (!active || currentPanelRoot()) {
        existing?.remove();
        state.dock = null;
        return;
    }
    if (!existing) {
        const dock = document.createElement('aside');
        dock.id = 'card-crafter-dock';
        dock.className = 'card-crafter-dock';
        document.body.appendChild(dock);
        state.dock = dock;
    }
    const dock = document.getElementById('card-crafter-dock');
    dock.innerHTML = `
      <div class="card-crafter-dock-head">
        <strong>${escapeHtml(active.label)}</strong>
        <span>${escapeHtml(jobStatusLabel(active))}</span>
      </div>
      <pre class="card-crafter-stream compact">${escapeHtml(active.text || active.reasoning || 'Waiting for the first tokens…')}</pre>
      <div class="card-crafter-actions wrap">
        <button type="button" class="card-crafter-ghost" data-cc-stop="${escapeHtml(active.id)}"><i class="fa-solid fa-stop"></i><span>Stop</span></button>
        <button type="button" class="card-crafter-secondary" id="cc-dock-open"><i class="fa-solid fa-up-right-from-square"></i><span>Open Card Crafter</span></button>
      </div>
    `;
    dock.querySelector('[data-cc-stop]')?.addEventListener('click', () => abortJob(active.id));
    dock.querySelector('#cc-dock-open')?.addEventListener('click', () => openCardCrafter());
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
        <textarea id="cc-extra" rows="3" placeholder="Must include a living lighthouse. No romance. Keep the prose dry.">${escapeHtml(state.lastExtra || '')}</textarea>
      </label>
      <label class="card-crafter-field">
        <span>Creativity <strong id="cc-creativity-label">${state.generateCreativity ?? settings.defaultCreativity} · ${creativityLabel(state.generateCreativity ?? settings.defaultCreativity)}</strong></span>
        <input type="range" id="cc-creativity" min="0" max="100" step="5" value="${state.generateCreativity ?? settings.defaultCreativity}">
      </label>
      ${renderDetailPicker('cc-detail', state.generateDetail ?? settings.defaultDetail)}
      <label class="card-crafter-check" id="cc-lore-wrap">
        <input type="checkbox" id="cc-include-lore" ${(state.generateIncludeLore ?? settings.autoImportLorebook) ? 'checked' : ''}>
        <span>Also draft a lorebook after the card</span>
      </label>
      <div class="card-crafter-actions">
        <button type="submit" class="card-crafter-primary" id="cc-generate-btn">
          <i class="fa-solid fa-bolt"></i>
          <span>Generate</span>
        </button>
      </div>
    </form>
    <div id="cc-generate-live"></div>
    <div id="cc-generate-result">${state.lastResult ? renderResult(state.lastResult, state.lastKind) : ''}</div>
  `;
}

function renderAnalyze() {
    return `
    <div class="card-crafter-form">
      <p class="card-crafter-lead">Pick a character already in SillyTavern, or upload a PNG / JSON card. Card Crafter asks your current model to grade it. This can take a while. Higher is sloppier.</p>
      ${renderLibraryPicker('cc-library')}
      <label class="card-crafter-drop" id="cc-drop">
        <input type="file" id="cc-file" accept=".png,.json,application/json,image/png">
        <i class="fa-solid fa-file-arrow-up"></i>
        <strong>${state.uploadedName || 'Or drop a card here'}</strong>
        <span>PNG tavern card or JSON</span>
      </label>
      <label class="card-crafter-field">
        <span>Or paste JSON</span>
        <textarea id="cc-paste" rows="6" placeholder='{"spec":"chara_card_v2", ...}'></textarea>
      </label>
      <div class="card-crafter-actions">
        <button type="button" class="card-crafter-primary" id="cc-analyze-btn">
          <i class="fa-solid fa-gauge-high"></i>
          <span>Ask the model</span>
        </button>
      </div>
    </div>
    <div id="cc-analyze-live"></div>
    <div id="cc-analyze-result">${state.analysis ? renderAnalysis(state.analysis, state.uploadedCard) : ''}</div>
  `;
}

function renderDetailPicker(id, selected, label = 'Detail') {
    const current = selected || 'standard';
    return `
      <div class="card-crafter-field">
        <span>${escapeHtml(label)} <strong id="${id}-label">${escapeHtml(detailLabel(current))}</strong></span>
        <div class="card-crafter-type-row card-crafter-detail-row" id="${id}-row">
          ${DETAIL_PRESETS.map((preset) => `
            <label class="card-crafter-chip${preset.id === current ? ' is-active' : ''}">
              <input type="radio" name="${id}" value="${preset.id}" ${preset.id === current ? 'checked' : ''}>
              <strong>${escapeHtml(preset.label)}</strong>
              <span>${escapeHtml(preset.hint)}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `;
}

function renderLibraryPicker(id) {
    const characters = listLibraryCharacters();
    const current = getCurrentCharacterRef();
    const selected = state.selectedAvatar || current?.avatar || '';
    if (!characters.length) {
        return `<p class="card-crafter-muted">No characters in your SillyTavern library yet.</p>`;
    }
    return `
      <label class="card-crafter-field">
        <span>Character already in SillyTavern</span>
        <div class="card-crafter-library">
          <select id="${id}" class="cc-library-select">
            <option value="">Select a loaded character…</option>
            ${characters.map((item) => `
              <option value="${escapeHtml(item.avatar)}" ${item.avatar === selected ? 'selected' : ''}>
                ${escapeHtml(characterOptionLabel(item, current?.avatar))}
              </option>
            `).join('')}
          </select>
          <button type="button" class="card-crafter-secondary cc-library-load" data-select="${id}">
            <i class="fa-solid fa-folder-open"></i><span>Use this card</span>
          </button>
        </div>
        <small>No export needed. This reads the card already sitting in your character list.</small>
      </label>
    `;
}

function renderRemake() {
    const settings = getSettings();
    const ready = Boolean(state.uploadedCard);
    const hasCritique = Boolean(state.analysis);
    const critiquePreview = formatAnalysisBrief(state.analysis);
    return `
    <div class="card-crafter-form">
      <p class="card-crafter-lead">Pick a character already in SillyTavern and remake it. If you already ran Analyze, that critique is applied automatically. Add your own extra direction on top.</p>
      ${renderLibraryPicker('cc-remake-library')}
      <label class="card-crafter-drop" id="cc-remake-drop">
        <input type="file" id="cc-remake-file" accept=".png,.json,application/json,image/png">
        <i class="fa-solid fa-recycle"></i>
        <strong>${state.uploadedName || 'Or upload a sloppy card'}</strong>
        <span>${ready ? 'Ready to remake' : 'PNG or JSON'}</span>
      </label>
      ${hasCritique ? `
      <details class="card-crafter-preview" open>
        <summary>Analyzer critique to apply</summary>
        <p>${escapeHtml(critiquePreview)}</p>
      </details>` : `<p class="card-crafter-muted">No Analyze result yet. Remake will still clean the card. Run Analyze first if you want the model to apply a specific critique.</p>`}
      <label class="card-crafter-field">
        <span>Extra changes <em>optional, wins over the critique</em></span>
        <textarea id="cc-remake-extra" rows="4" placeholder="Keep the name. Cut the harem bait. Make her a competent cartographer.">${escapeHtml(state.remakeExtra || '')}</textarea>
      </label>
      <label class="card-crafter-field">
        <span>Creativity <strong id="cc-remake-creativity-label">${state.remakeCreativity ?? settings.defaultCreativity} · ${creativityLabel(state.remakeCreativity ?? settings.defaultCreativity)}</strong></span>
        <input type="range" id="cc-remake-creativity" min="0" max="100" step="5" value="${state.remakeCreativity ?? settings.defaultCreativity}">
      </label>
      ${renderDetailPicker('cc-remake-detail', state.remakeDetail ?? settings.defaultDetail)}
      <label class="card-crafter-check">
        <input type="checkbox" id="cc-remake-lore" ${state.remakeIncludeLore ? 'checked' : ''}>
        <span>Build a lorebook after the remake</span>
      </label>
      <div class="card-crafter-actions">
        <button type="button" class="card-crafter-primary" id="cc-remake-btn">
          <i class="fa-solid fa-screwdriver-wrench"></i>
          <span>Remake card</span>
        </button>
      </div>
    </div>
    <div id="cc-remake-live"></div>
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
      ${renderDetailPicker('cc-default-detail', settings.defaultDetail, 'Default detail')}
      <label class="card-crafter-check">
        <input type="checkbox" id="cc-unlimited-tokens" ${!Number(settings.maxResponseTokens) ? 'checked' : ''}>
        <span>Unlimited response length</span>
      </label>
      <label class="card-crafter-field" id="cc-max-tokens-wrap">
        <span>Max response tokens</span>
        <input type="number" id="cc-max-tokens" min="256" step="100" value="${Number(settings.maxResponseTokens) > 0 ? settings.maxResponseTokens : 3500}">
        <small>Leave Unlimited on if you want the model to write as long as it wants. A number here is only a safety cap.</small>
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
      <p class="card-crafter-muted">Error logs: <code>SillyTavern/data/&lt;user&gt;/user/files/ERROR_LOG_*.txt</code>. Named <code>[ERROR LOG] (n) [DD/MM/YYYY] [HH:MM:SS]</code>. ${Array.isArray(settings.errorLogs) && settings.errorLogs.length ? `${settings.errorLogs.length} stored.` : 'None yet.'}</p>
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
    const loreCount = (payload.lorebook || []).length;
    return `
    <article class="card-crafter-result">
      <header class="card-crafter-result-head">
        <div>
          <h3>${escapeHtml(payload.name)}</h3>
          <p>${wordCount(payload.description)}w description · ${wordCount(payload.first_mes)}w greeting${loreCount ? ` · ${loreCount} lore entries` : ''}</p>
        </div>
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
          <p>${analysis.isSlop ? 'Flagged as slop' : 'Below the slop line'} · AI judge · threshold ${getSettings().slopThreshold}</p>
        </div>
        ${renderMeter(analysis.score, band)}
      </header>
      <p class="card-crafter-lead">${escapeHtml(analysis.aiSummary || band.hint)}</p>
      ${hasBreakdown(analysis.breakdown) ? `<div class="card-crafter-bars">
        ${renderBar('Cliches', analysis.breakdown.creativity)}
        ${renderBar('Completeness', analysis.breakdown.completeness)}
        ${renderBar('Formatting', analysis.breakdown.formatting)}
        ${renderBar('Repetition', analysis.breakdown.repetition)}
        ${renderBar('Bloat', analysis.breakdown.tokenEfficiency)}
      </div>` : ''}
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

function hasBreakdown(breakdown) {
    if (!breakdown) return false;
    return Object.values(breakdown).some((value) => Number(value) > 0);
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
        switchTab(root, 'remediate');
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
            reportError(error, { source: 'import-lorebook', extra: { name: state.lastResult?.name || '' } });
        } finally {
            setBusy(btn, false);
        }
    });
    root.querySelector('[data-cc-download-lore]')?.addEventListener('click', () => {
        const book = toLorebookPayload(state.lastResult);
        const file = buildWorldInfoFile(book);
        downloadTextFile(`${sanitizeFileName(book.name || 'lorebook')}.json`, JSON.stringify(file, null, 2));
    });
    root.querySelector('[data-cc-import-persona]')?.addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        try {
            setBusy(btn, true, 'Importing…');
            const persona = toPersonaPayload(state.lastResult);
            await importPersonaToSillyTavern(persona);
            describeImport('Persona', persona.name);
        } catch (error) {
            reportError(error, { source: 'import-persona', extra: { name: persona?.name || '' } });
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
            worldName = await importLorebookToSillyTavern(payload.lorebook, raw?.lorebook_name || `${payload.name} Lore`);
        }
        await importCharacterToSillyTavern(payload, { worldName });
        describeImport('Character', payload.name);
    } catch (error) {
        reportError(error, { source: 'import-character', extra: { name: payload?.name || '', withLore } });
    } finally {
        setBusy(btn, false);
    }
}


function bindDetailPicker(root, name, onChange) {
    const row = root.querySelector(`#${name}-row`);
    const label = root.querySelector(`#${name}-label`);
    root.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
        input.addEventListener('change', () => {
            const value = input.value;
            row?.querySelectorAll('.card-crafter-chip').forEach((chip) => {
                chip.classList.toggle('is-active', chip.querySelector('input')?.value === value);
            });
            if (label) label.textContent = detailLabel(value);
            onChange?.(value);
        });
    });
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
        state.generateCreativity = Number(slider.value);
        label.textContent = `${slider.value} · ${creativityLabel(slider.value)}`;
    });
    bindDetailPicker(root, 'cc-detail', (value) => {
        state.generateDetail = value;
    });
    root.querySelector('#cc-concept')?.addEventListener('input', (event) => {
        state.lastConcept = event.currentTarget.value;
    });
    root.querySelector('#cc-extra')?.addEventListener('input', (event) => {
        state.lastExtra = event.currentTarget.value;
    });
    root.querySelector('#cc-include-lore')?.addEventListener('change', (event) => {
        state.generateIncludeLore = Boolean(event.currentTarget.checked);
    });

    root.querySelector('#cc-generate-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const concept = root.querySelector('#cc-concept').value.trim();
        if (!concept) {
            toast('warning', 'Describe the concept first.');
            return;
        }
        const extra = root.querySelector('#cc-extra').value.trim();
        const creativity = Number(slider.value);
        const includeLorebook = Boolean(root.querySelector('#cc-include-lore')?.checked);
        const detail = root.querySelector('input[name="cc-detail"]:checked')?.value || getSettings().defaultDetail;
        state.lastConcept = concept;
        state.lastExtra = extra;
        state.generateCreativity = creativity;
        state.generateIncludeLore = includeLorebook;
        state.generateDetail = detail;
        startGenerateJob({
            type: state.genType,
            concept,
            extra,
            creativity,
            detail,
            includeLorebook,
        });
        toast('info', 'Generation started. You can switch tabs or keep chatting.');
    });
}

function bindLibraryPicker(root) {
    root.querySelectorAll('.cc-library-load').forEach((button) => {
        button.addEventListener('click', async () => {
            const select = root.querySelector(`#${button.dataset.select}`);
            const avatar = select?.value;
            if (!avatar) {
                toast('warning', 'Pick a character from your library first.');
                return;
            }
            try {
                setBusy(button, true, 'Loading…');
                await ingestLibraryCard(avatar, root);
            } catch (error) {
                reportError(error, { source: 'library-load', extra: { avatar } });
            } finally {
                setBusy(button, false);
            }
        });
    });
    root.querySelectorAll('.cc-library-select').forEach((select) => {
        select.addEventListener('change', async () => {
            if (!select.value) return;
            try {
                await ingestLibraryCard(select.value, root);
            } catch (error) {
                reportError(error, { source: 'library-select', extra: { avatar: select.value } });
            }
        });
    });
}

async function ingestLibraryCard(avatar, root, { quiet = false } = {}) {
    const card = await loadLibraryCharacter(avatar);
    state.uploadedCard = card;
    state.uploadedName = card.name || 'Library card';
    state.selectedAvatar = avatar;
    const drop = root.querySelector('.card-crafter-drop strong');
    if (drop) drop.textContent = state.uploadedName;
    const remakeBtn = root.querySelector('#cc-remake-btn');
    if (remakeBtn) remakeBtn.disabled = false;
    if (!quiet) toast('info', `Loaded ${state.uploadedName} from your library.`);
    return card;
}

function bindAnalyze(root) {
    bindLibraryPicker(root);
    root.querySelector('#cc-file')?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (file) await ingestCard(file, root);
    });
    root.querySelector('#cc-analyze-btn')?.addEventListener('click', async () => {
        try {
            const pasted = root.querySelector('#cc-paste').value.trim();
            if (pasted) {
                state.uploadedCard = parseImportedCard(pasted);
                state.uploadedName = state.uploadedCard.name || 'Pasted card';
            }
            const card = await ensureCardLoaded(root);
            if (!card) return;
            startAnalyzeJob({
                card,
                threshold: getSettings().slopThreshold,
            });
            toast('info', 'Judging started. You can switch tabs or keep chatting.');
        } catch (error) {
            reportError(error, { source: 'analyze-start' });
        }
    });
}

function bindRemake(root) {
    bindLibraryPicker(root);
    const slider = root.querySelector('#cc-remake-creativity');
    const label = root.querySelector('#cc-remake-creativity-label');
    slider?.addEventListener('input', () => {
        state.remakeCreativity = Number(slider.value);
        label.textContent = `${slider.value} · ${creativityLabel(slider.value)}`;
    });
    bindDetailPicker(root, 'cc-remake-detail', (value) => {
        state.remakeDetail = value;
    });
    root.querySelector('#cc-remake-extra')?.addEventListener('input', (event) => {
        state.remakeExtra = event.currentTarget.value;
    });
    root.querySelector('#cc-remake-lore')?.addEventListener('change', (event) => {
        state.remakeIncludeLore = Boolean(event.currentTarget.checked);
    });
    root.querySelector('#cc-remake-file')?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (file) {
            await ingestCard(file, root);
            renderTab(root);
        }
    });
    root.querySelector('#cc-remake-btn')?.addEventListener('click', async () => {
        try {
            const card = await ensureCardLoaded(root);
            if (!card) return;
            const extra = root.querySelector('#cc-remake-extra')?.value.trim() || '';
            const includeLorebook = Boolean(root.querySelector('#cc-remake-lore')?.checked);
            const creativity = Number(slider?.value ?? getSettings().defaultCreativity);
            const detail = root.querySelector('input[name="cc-remake-detail"]:checked')?.value || getSettings().defaultDetail;
            state.remakeExtra = extra;
            state.remakeIncludeLore = includeLorebook;
            state.remakeCreativity = creativity;
            state.remakeDetail = detail;
            startRemakeJob({
                card,
                extra,
                critique: formatAnalysisBrief(state.analysis),
                creativity,
                detail,
                includeLorebook,
            });
            toast('info', 'Remake started. You can switch tabs or keep chatting.');
        } catch (error) {
            reportError(error, { source: 'remake-start' });
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
    bindDetailPicker(root, 'cc-default-detail');
    const unlimited = root.querySelector('#cc-unlimited-tokens');
    const tokenWrap = root.querySelector('#cc-max-tokens-wrap');
    const tokenInput = root.querySelector('#cc-max-tokens');
    const syncTokenUi = () => {
        const on = Boolean(unlimited?.checked);
        if (tokenWrap) tokenWrap.style.display = on ? 'none' : '';
        if (tokenInput) tokenInput.disabled = on;
    };
    unlimited?.addEventListener('change', syncTokenUi);
    syncTokenUi();
    root.querySelector('#cc-settings-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        updateSetting('profileId', root.querySelector('#cc-profile').value);
        updateSetting('creatorName', root.querySelector('#cc-creator').value.trim());
        updateSetting('slopThreshold', Number(threshold.value));
        updateSetting('defaultCreativity', Number(creativity.value));
        updateSetting('defaultDetail', root.querySelector('input[name="cc-default-detail"]:checked')?.value || 'standard');
        updateSetting('maxResponseTokens', unlimited?.checked ? 0 : (Number(tokenInput?.value) || 3500));
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
        state.selectedAvatar = '';
        const drop = root.querySelector('.card-crafter-drop strong');
        const remakeBtn = root.querySelector('#cc-remake-btn');
        if (remakeBtn) remakeBtn.disabled = false;
        if (drop) drop.textContent = state.uploadedName;
        toast('info', `Loaded ${state.uploadedName}`);
    } catch (error) {
        reportError(error, { source: 'ingest-card', extra: { file: file?.name || '' } });
    }
}
