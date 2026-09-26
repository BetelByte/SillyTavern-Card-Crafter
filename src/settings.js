import { DEFAULT_SETTINGS, MODULE_NAME } from './constants.js';

export function getContext() {
    return SillyTavern.getContext();
}

export function getSettings() {
    const ctx = getContext();
    const current = ctx.extensionSettings[MODULE_NAME];
    if (!current || typeof current !== 'object') {
        ctx.extensionSettings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
        return ctx.extensionSettings[MODULE_NAME];
    }
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (current[key] === undefined) current[key] = value;
    }
    return current;
}

export function saveSettings() {
    getContext().saveSettingsDebounced();
}

export function updateSetting(key, value) {
    const settings = getSettings();
    settings[key] = value;
    saveSettings();
    return settings;
}

export function resetSettings() {
    const ctx = getContext();
    ctx.extensionSettings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
    saveSettings();
    return ctx.extensionSettings[MODULE_NAME];
}

export function getConnectionProfiles() {
    const ctx = getContext();
    const cm = ctx.extensionSettings?.connectionManager;
    if (Array.isArray(cm?.profiles) && cm.profiles.length) {
        return cm.profiles
            .map((p) => ({ id: p.id, name: p.name || p.id }))
            .filter((p) => p.id);
    }
    try {
        const svc = ctx.ConnectionManagerRequestService;
        if (svc && typeof svc.getSupportedProfiles === 'function') {
            return svc.getSupportedProfiles()
                .map((p) => ({ id: p.id, name: p.name || p.id }))
                .filter((p) => p.id);
        }
    } catch (_) {
        /* Connection Manager may not be loaded. */
    }
    return [];
}

export function getActiveProfileId() {
    const settings = getSettings();
    if (settings.profileId) return settings.profileId;
    const ctx = getContext();
    return ctx.extensionSettings?.connectionManager?.selectedProfile || '';
}
