# Dinners

A small installable web app for a family's dinner plan: this week's dinners from a Google
Calendar, recipes with a servings changer, quick edits and swaps. It reads and writes a
Google Sheet through that Sheet's Apps Script web app. Plain HTML, CSS and JavaScript, no
build step.

This repository holds no data and no secrets. Each phone keeps the web app URL and its
secret in its own browser storage, set by opening a setup link made in the Sheet.

| File | What it is |
|---|---|
| `index.html`, `app.css` | The page and its styles |
| `js/app.js` | Screens, navigation and talking to the web app |
| `js/scale.js` | Scaling ingredient amounts (shared with the fridge display) |
| `sw.js`, `manifest.json`, `icons/` | What makes it installable and work offline |

## Releasing

Bump `CACHE_VERSION` in `sw.js`, commit and push. GitHub Pages serves the `main` branch.
