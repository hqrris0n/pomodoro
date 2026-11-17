# Café Pomodoro

A café-themed pomodoro timer: a Vite + Svelte 5 + TypeScript single-page app
(not SvelteKit), built to static files. A small Go server (in `server/`,
standard library only) serves them and provides the `/api` endpoints.

## Layout

- `web/` - the single-page app; run all npm commands from here.
- `web/src/main.ts` - entry point; mounts `App.svelte`.
- `web/src/App.svelte` - holds the `screen` state and picks the screen (no router).
- `web/src/screens/` - top-level screens (`Setup`, `Timer`).
- `web/src/styles/` - `global.css` (minimal reset) and `tokens.css` (design tokens).
- `web/src/lib/<feature>/` - one folder per feature: `timer`, `todos`, `drinks`,
  `audio`, `rooms`, `scene`, `backgrounds`, `shell`.
- `web/src/lib/storage.ts` - `load`/`save` JSON in localStorage under the `cafe:` prefix.
- `web/public/drinks/`, `web/public/sounds/` - static assets, served as-is.
- `web/e2e/` - Playwright tests (chromium; desktop and Pixel 7 projects).
- `server/` - Go server: static files plus the in-memory rooms API.
- `Dockerfile`, `compose.yml`, `deploy/` - container build and a sample Caddy config.
- `docs/` - `design.md` (design rules) and `protocol.md` (server protocol).

## Commands (run from `web/`)

- Install: `npm install`, then `npm run e2e:install` (browser goes to `web/.playwright-browsers`)
- Dev server: `npm run dev` (proxies `/api` to `localhost:8080`)
- Format: `npm run format` (check only: `npm run format:check`)
- Lint: `npm run lint`
- Typecheck: `npm run check`
- Unit tests: `npm run test`
- E2E tests: `npm run e2e`
- Production build: `npm run build` (output in `web/dist`)

Server (from `server/`; Go 1.27, or the `golang:1.27` image): `gofmt -l .`,
`go vet ./...`, `go test -race ./...`. Whole app: `docker build -t cafe-timer .`

## Conventions

- Svelte 5 runes only (`$state`, `$derived`, `$props`, `$effect`).
- TypeScript strict mode.
- No new dependencies without asking; keep the bundle lean for phones.
- One feature per `src/lib/<feature>/` folder; do not edit shared config
  to add a feature.
- Tests live beside the code as `*.test.ts`.
- Persistent browser state goes only through `lib/storage.ts`.
- Colours, spacing and fonts only via CSS variables from `styles/tokens.css`.
- Design rules: `docs/design.md`. Server protocol: `docs/protocol.md`.
