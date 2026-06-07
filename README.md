# Global Radio

A single-page web app for exploring and playing global internet radio stations on an interactive 3D globe.

## Features

- **3D Globe** — Interactive WebGL globe with station markers using [globe.gl](https://globe.gl/)
- **Live Radio Data** — Fetches 500 top-clicked stations from [radio-browser.info](https://www.radio-browser.info/) with client-side health filtering
- **Station Cards** — Three-column grid with country, genre tags, and color-coded status dots with equalizer animation on playback
- **Two-Way Sync** — Hover/click a globe marker or a station card; both highlight and scroll in sync
- **Faceted Filters** — Country + genre dropdowns with live relative counts that recompute as you filter; persisted in the URL
- **⌘K Search** — Modal search across station names, countries, tags, and states
- **Favorites** — Heart stations; persisted in `localStorage`
- **Dark Mode** — Theme toggle with OS preference detection and persistent setting
- **Sleep Timer** — 15/30/45/60 minute auto-stop timer
- **Volume Control** — Slider with percentage display and mute toggle
- **Buffering Indicator** — Animated spinner while a stream connects
- **Error Handling** — Retry button if the API fails to load
- **Empty State** — Clear message and "Clear filters" button when no stations match
- **Keyboard Accessible** — Full keyboard navigation and screen reader support

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

### GitHub Pages (already configured)

Push to `main` — the included GitHub Action builds and deploys automatically.

**Live:** https://soufianeoi.github.io/global-radio/

### Vercel / Netlify

Drop the `dist/` folder after building.

## License

MIT
