# SillyTavern Card Crafter

A mobile-first SillyTavern extension that turns a concept into a character card, lorebook, or persona. It can also score an existing card with a **slop-o-meter** and remake it.

![SillyTavern](https://img.shields.io/badge/SillyTavern-extension-8b6cc1) ![License](https://img.shields.io/badge/license-MIT-olive)

## What it does

- **Generate** — describe a character, setting, or user persona. Card Crafter asks your current SillyTavern model for a structured V2 card, a world-info book, or a persona.
- **Lorebook when needed** — character generation can draft keyed world-info entries and import them with the card.
- **Slop-o-meter** — upload a PNG tavern card or JSON. Higher score = sloppier. It flags cliches, mashed fields, jailbreak leftovers, empty mystery, repetition, and missing pieces.
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

### Analyze

Upload a `.png` character card or `.json`. The meter is 0–100:

| Score | Band |
| --- | --- |
| 0–24 | Clean |
| 25–44 | Okay |
| 45–64 | Sloppy |
| 65–79 | Slop |
| 80–100 | Toxic slop |

Optional: turn on **Blend in an extra AI judge** in settings. That spends tokens and mixes the model’s grade with the heuristic.

### Remake

Upload the bad card, say what to keep or cut, set creativity, and remake. Import the new character and lorebook when you like it.

## Settings

- Connection profile
- Creator name stamped on new cards
- Slop threshold (default 55)
- Default creativity
- Max response tokens
- Auto-draft lorebook with characters
- Optional AI slop judge

## Notes

- No extra API key. It uses the model SillyTavern already has selected.
- Personas are imported as user personas, not bot cards.
- PNG read support is for standard tavern `chara` chunks. Compressed chunks should be exported as JSON first.
- This is not a jailbreak tool and it will not write one into your cards.

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
    ui.js
    utils.js
```

Requires a current SillyTavern (`staging` or a recent release).

## License

MIT
