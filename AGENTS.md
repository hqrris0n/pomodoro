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

## Testing

- Every feature and bug fix ships with tests that would fail without it. For a bug,
  write the failing test first.
- Test behaviour once: logic, server rules and concurrency (races, sessions, rooms)
  need one run, not one per screen size.
- Test layout at every size where it differs: anything that looks different on phones
  gets an e2e check in `web/e2e/layout.spec.ts`, which runs on both Playwright projects
  and down to 320px wide. Check for cut-off content, sideways scrolling, overlaps and
  wrapped button labels.
- Keep the screenshot baselines in `web/e2e/visual.spec.ts` current. After an intended
  visual change, look at the diff, then run `npm run e2e -- visual --update-snapshots`.
  The baselines are macOS ones; Linux or CI needs its own set.
- Do not delete or skip a test to make a change pass; update it to the new spec and
  say so in the commit.
- Wait for what a measurement depends on (fonts, drinks, the scene) before measuring,
  so a test fails only for a real reason.
- Before calling a feature done, run the full check: the web commands above,
  `go test -race ./...` in `server/` (or in the `golang:1.27` image), then
  `npm run e2e` with `E2E_SERVER` set to a container of the freshly built image, so the
  account and room tests run too.
