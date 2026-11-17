# Café Pomodoro

A pomodoro timer dressed as a small pixel-art café. You place an order (how
long, how many rounds, which drink), and while you work a crew of baristas
carries cups up a ladder to fill your glass. When the glass is full, your
drink is ready and so are you.

## What it does

- **Timer.** Presets of 5, 15, 30 and 60 minutes, or anything from 1 minute to
  3 hours. One to six rounds with 5, 10 or 15 minute breaks. Pause, resume,
  leave. The countdown shows in the tab title and survives a page reload.
- **Drinks.** Eight to pick from. The choice decides what the baristas pour.
- **To-do list.** Add, check off, reorder by dragging, clear what is done. It
  stays with you from round to round.
- **Backgrounds.** Five animated scenes: a rainy window seat, a sunny morning
  counter, a night café, a fireplace nook and a rooftop at dusk. Pick one or
  let them rotate.
- **Sound.** Ten ambient loops (chatter, espresso machine, rain, fireplace and
  so on), each with its own volume. Save your own mixes or start from a
  built-in one. Sound is off until you turn it on.
- **Shared timers.** Everyone on the same server can see who is brewing and
  join in. Joining mirrors the owner's timer, drink, background and sounds.
  Owners can promote a guest to co-owner. If the owner leaves, the timer keeps
  going and the longest-standing guest takes over.

There are no accounts. Settings, to-dos and saved mixes live in your browser.

## How it is built

| Part | What | Where |
| --- | --- | --- |
| Web app | Svelte 5 + TypeScript, built with Vite into static files | `web/` |
| Server | One Go program, standard library only. Serves the static files and keeps the list of shared timers in memory | `server/` |
| Container | Both of the above in a single image of about 8 MB that idles at under 10 MB of RAM | `Dockerfile`, `compose.yml` |

The timer is computed from a start time, not counted down by the server, so
the server does nothing between events and a solo timer keeps working when
the server cannot be reached. Details are in [docs/protocol.md](docs/protocol.md).
The visual rules are in [docs/design.md](docs/design.md).

## Run it

With Docker:

```sh
docker build -t cafe-timer .
docker run --rm -p 8080:8080 cafe-timer
```

Then open <http://localhost:8080>. `compose.yml` is set up for running behind
a reverse proxy on a shared Docker network, and
[deploy/Caddyfile.example](deploy/Caddyfile.example) is a matching Caddy site
block.

## Develop

Needs Node 24 or newer. Go is only needed if you want to run the server
outside Docker.

```sh
cd web
npm install
npm run e2e:install   # once: downloads a browser for the end-to-end tests
npm run dev           # app on http://localhost:5173, /api proxied to :8080
```

The app works without the server; only the shared-timer menu stays empty. To
have the server as well, run the container above next to `npm run dev`.

| Command (from `web/`) | Does |
| --- | --- |
| `npm run format` | Format with Prettier |
| `npm run lint` | ESLint |
| `npm run check` | Type-check |
| `npm run test` | Unit tests (Vitest) |
| `npm run e2e` | End-to-end tests (Playwright, desktop and phone) |
| `npm run build` | Production build into `web/dist` |

Server tests, from `server/`: `go vet ./... && go test -race ./...`

During development, `http://localhost:5173/#demo/<Name>` shows any
`<Name>.demo.svelte` component on its own, for example `#demo/BrewScene`.

## Make it yours

**Drinks.** Edit `web/public/drinks/drinks.json` and put a picture next to it.
Each entry has an `id`, a `name`, an `image` file name, and a `glass` recipe:
the coloured `layers` from bottom to top with their `share` of the glass,
whether there is `ice`, a `topping` (`none`, `foam`, `cream` or `lemon`), a
`straw` colour or `null`, and whether it is `hot` (steam). Remove an entry to
take a drink off the menu.

**Sounds.** Run `web/scripts/make-loop.sh recording.wav web/public/sounds/name.mp3`
(needs ffmpeg) to turn a recording into a seamless one-minute loop, then add
a line to `web/public/sounds/sounds.json`.

**Backgrounds.** Scenes are Svelte components in
`web/src/lib/backgrounds/scenes/`, listed in `registry.ts` in the folder above.

Both `drinks/` and `sounds/` can also be mounted over the ones in the
container, so the menu can change without a rebuild; see the comment in
`compose.yml`.

## Credits

Sound sources and licences are listed in [CREDITS.md](CREDITS.md). The font
is [Jersey 25](https://fonts.google.com/specimen/Jersey+25) (SIL Open Font
License).
