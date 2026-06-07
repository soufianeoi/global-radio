# Global Radio

A single-page web app for exploring and playing global internet radio stations on an interactive 3D globe.

## Features

- **3D Globe** — Interactive WebGL globe with station markers using [globe.gl](https://globe.gl/)
- **Live Radio Data** — Fetches 500 top-clicked stations from [radio-browser.info](https://www.radio-browser.info/) with client-side health filtering
- **Station Cards** — Three-column grid with country, genre tags, and color-coded status dots
- **Two-Way Sync** — Hover/click a globe marker or a station card; both highlight and scroll in sync
- **Faceted Filters** — Country + genre dropdowns with live relative counts that recompute as you filter
- **⌘K Search** — Modal search across station names, countries, tags, and states
- **Favorites** — Heart stations; persisted in `localStorage`
- **Sleep Timer** — 15/30/45/60 minute auto-stop timer
- **Minimal UI** — White Linear/Vercel aesthetic, Inter font, hand-written CSS

## Tech Stack

- Vite (vanilla JS, no React/Tailwind/UI libs)
- globe.gl (Three.js-based 3D globe)
- radio-browser.info API

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Build

```bash
npm run build
```

Output goes to `dist/`.

## Deploy

### GitHub Pages

1. Push this repo to GitHub
2. Go to **Settings → Pages**
3. Set **Source** to "GitHub Actions"
4. Use the included workflow (`.github/workflows/deploy.yml`) or Vite's default Pages action

### Vercel / Netlify

Drop the `dist/` folder after building.

## License

MIT
