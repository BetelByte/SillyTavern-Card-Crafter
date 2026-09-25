import { EXTENSION_NAME, MODULE_NAME } from './src/constants.js';
import { getSettings } from './src/settings.js';
import { closeCardCrafter, openCardCrafter } from './src/ui.js';
import { toast } from './src/utils.js';

const globalContext = SillyTavern.getContext();

function importCheck() {
    return Boolean(globalContext && typeof globalContext.renderExtensionTemplateAsync === 'function');
}

function addToolbarButton() {
    if (document.querySelector('.card-crafter-launch')) return;

    const button = document.createElement('div');
    button.className = 'menu_button fa-solid fa-wand-magic-sparkles interactable card-crafter-launch';
    button.title = 'Card Crafter';
    button.setAttribute('tabindex', '0');
    button.setAttribute('role', 'button');
    button.addEventListener('click', openCardCrafter);
    button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openCardCrafter();
        }
    });

    const targets = [
        document.querySelector('#rm_buttons_container'),
        document.querySelector('.form_create_bottom_buttons_block'),
        document.querySelector('#form_character_search_form'),
        document.querySelector('#top-settings-holder'),
        document.querySelector('#left-nav-panel'),
    ];

    const host = targets.find(Boolean);
    if (host) {
        host.prepend(button);
    } else {
        document.body.appendChild(button);
        button.classList.add('card-crafter-launch-floating');
    }
}

async function addSettingsDrawer() {
    const container = document.querySelector('#extensions_settings');
    if (!container || container.querySelector('.card-crafter-settings')) return;

    try {
        const html = await globalContext.renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'settings');
        container.insertAdjacentHTML('beforeend', html);
    } catch (error) {
        console.warn('[Card Crafter] Could not render settings template, using fallback.', error);
        container.insertAdjacentHTML('beforeend', `
            <div class="card-crafter-settings">
                <div class="inline-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>Card Crafter</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content">
                        <div class="menu_button menu_button_icon interactable card-crafter-open-settings-btn">
                            <i class="fa-solid fa-wand-magic-sparkles"></i>
                            <span>Open Card Crafter</span>
                        </div>
                    </div>
                </div>
            </div>
        `);
    }

    container.querySelector('.card-crafter-open-settings-btn')?.addEventListener('click', openCardCrafter);
}

function registerSlashCommand() {
    try {
        const { SlashCommandParser, SlashCommand } = globalContext;
        if (!SlashCommandParser || !SlashCommand) return;
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'cardcrafter',
            aliases: ['ccraft', 'card-crafter'],
            callback: () => {
                openCardCrafter();
                return '';
            },
            helpString: 'Open Card Crafter to generate or remake a character, lorebook, or persona.',
        }));
    } catch (error) {
        console.warn('[Card Crafter] Slash command registration failed.', error);
    }
}

export async function init() {
    getSettings();
    addToolbarButton();
    await addSettingsDrawer();
    registerSlashCommand();
    window.openCardCrafter = openCardCrafter;
    window.closeCardCrafter = closeCardCrafter;
}

if (!importCheck()) {
    toast('error', 'SillyTavern is too old for Card Crafter. Update ST and try again.');
} else {
    init().catch((error) => {
        console.error(`[${MODULE_NAME}] init failed`, error);
        toast('error', error.message || 'Card Crafter failed to load.');
    });
}
