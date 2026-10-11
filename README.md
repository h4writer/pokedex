# Pokédex

A Pokémon GO–style Pokédex to track which Pokémon (and optionally which TCG cards) you have.

- Pure static site: `index.html`, `style.css`, `app.js`, `pokemon-data.js` — no build step.
- Collection is stored in the browser (`localStorage`). Use the ⋮ menu to export/import a backup.
- Sprites and artwork load from the [PokeAPI sprites](https://github.com/PokeAPI/sprites) repo.

## Quick add

Type a name or number in the search box, press **Enter** (opens the Pokémon), press **Enter** again (adds it).
The search box clears and is ready for the next one.

## Run locally

Open `index.html` in a browser.
