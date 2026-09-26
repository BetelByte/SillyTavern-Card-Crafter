# SillyTavern Card Crafter

A mobile-first SillyTavern extension that turns a concept into a character card, lorebook, or persona. It can also score an existing card with a **slop-o-meter** and remake it.

![SillyTavern](https://img.shields.io/badge/SillyTavern-extension-8b6cc1) ![License](https://img.shields.io/badge/license-MIT-olive)

## What it does

- **Generate** — describe a character, setting, or user persona. Card Crafter asks your current SillyTavern model for a structured V2 card, a world-info book, or a persona.
- **Lorebook when needed** — character generation can draft keyed world-info entries and import them with the card.
- **Slop-o-meter** — pick a library card or upload a PNG / JSON. Your current SillyTavern model grades it. Higher score = sloppier. It flags cliches, mashed fields, jailbreak leftovers, empty mystery, repetition, and missing pieces.
- **Remake** — keep the soul of the character, rewrite the slop, optionally build a proper lorebook. Creativity is a slider, not a vibe.
- **Import or download** — push the result into SillyTavern, or save JSON.

It is built as a bottom-sheet on phones and a centered panel on desktop. Buttons are 44px, tabs are thumb-sized, and it follows your SillyTavern theme colors.

## Install

In SillyTavern:

1. Open **Extensions** → **Install extension**
2. Paste:

```txt
https://github.com/BetelByte/SillyTavern-Card-Crafter
```

3. Enable **Card Crafter**
4. Reload if the wand button does not appear

Manual install: clone this repo into `public/scripts/extensions/third-party/SillyTavern-Card-Crafter`.

## Use

- Click the wand button on the character list / create form
- Or open **Extensions** → **Card Crafter** → **Open Card Crafter**
- Or run `/cardcrafter`

You need a working model selected in SillyTavern. If you use **Connection Manager**, pick a profile in the extension settings. Chat-completion models that can return JSON work best.

### Generate

1. Choose Character, Lorebook, or Persona
2. Describe the concept
3. Set creativity (0 = faithful, 100 = wild)
4. Generate, preview, then **Import** or **Download JSON**

Generation streams live in the panel. You can switch tabs, close Card Crafter, or keep chatting while it runs. A floating dock keeps the stream and a **Stop** button visible.

### Analyze

Pick a character already in your SillyTavern library, or upload a `.png` / `.json` card. Card Crafter asks your current model to grade it (this can take a while). The meter is 0–100:

| Score | Band |
| --- | --- |
| 0–24 | Clean |
| 25–44 | Okay |
| 45–64 | Sloppy |
| 65–79 | Slop |
| 80–100 | Toxic slop |

Analyze is AI-only. It uses tokens and waits on the model. There is no local heuristic fallback.

### Remake

Select the character from your library (or upload a card), say what to keep or cut, set creativity, and remake. If you already ran Analyze, that critique is applied automatically. Use **Extra changes** for anything else you want rewritten; your notes win if they conflict with the judge. Import the new character and lorebook when you like it.

## Settings

- Connection profile
- Creator name stamped on new cards
- Slop threshold (default 55)
- Default creativity
- Max response tokens, or Unlimited (default)
- Auto-draft lorebook with characters
- Error logs written to `SillyTavern/data/<user>/user/files/` as `ERROR_LOG_<n>_<DD-MM-YYYY>_<HH-MM-SS>.txt`

## Notes

- No extra API key. It uses the model SillyTavern already has selected.
- Personas are imported as user personas, not bot cards.
- PNG read support is for standard tavern `chara` / `ccv3` chunks, including compressed `zTXt` / `iTXt` when the browser can inflate them.
- This is not a jailbreak tool and it will not write one into your cards.
- When something breaks, Card Crafter writes a numbered error log. Tell the assistant to scan those files instead of pasting the toast.

## Development

Vanilla ES modules. No build step.

```txt
SillyTavern-Card-Crafter/
  index.js          # extension entry
  style.css
  manifest.json
  settings.html
  src/
    constants.js
    settings.js
    prompts.js
    generate.js
    slop.js
    importers.js
    error-log.js
    jobs.js
    ui.js
    utils.js
```

Requires a current SillyTavern (`staging` or a recent release).

## License

MIT
