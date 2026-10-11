# Pokédex

A Pokémon GO–style Pokédex to track which Pokémon (and optionally which TCG cards) you have.

- Pure static site: `index.html`, `style.css`, `app.js`, `pokemon-data.js` — no build step.
- The collection is stored in `collection.json` in this repo, so everyone visiting the site sees it.
  Editing requires a GitHub token (⋮ → Edit mode); visitors without one get a read-only view.
  Each change becomes a commit like "Add Pikachu".
- Sprites and artwork load from the [PokeAPI sprites](https://github.com/PokeAPI/sprites) repo.

## Quick add

Type a name or number in the search box, press **Enter** (opens the Pokémon), press **Enter** again (adds it).
The search box clears and is ready for the next one.

## Edit mode

Create a fine-grained token at https://github.com/settings/personal-access-tokens/new with access to
only this repository and **Contents: Read and write**. Paste it in ⋮ → Edit mode. It is stored only in that browser.

## Run locally

Open `index.html` in a browser. Without GitHub Pages it saves to the browser only.

## Updating

When you change `app.js`, `style.css` or `pokemon-data.js`, bump the `?v=` number in `index.html`
so browsers don't keep using a cached old version.
