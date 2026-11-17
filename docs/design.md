# Design spec

Pixel-art café. One idea carries the interface: **you are placing an order.**
The setup form is an order ticket, the todo list is the receipt paper under it,
and the timer screen is the counter where the order gets made. Everything else
stays quiet so the scene and the drink are the memorable part.

## Palette

One 16-colour master palette for UI and all art. Use the CSS variables from
`web/src/styles/tokens.css`; never write a hex value in a component.

| Token          | Hex       | Use                                             |
| -------------- | --------- | ----------------------------------------------- |
| `--ink`        | `#2b1f2e` | Outlines, text, hard shadows                    |
| `--plum`       | `#4a3145` | Secondary text, dark wood shade                 |
| `--walnut`     | `#6b4337` | Wood, counter, ticket clip                      |
| `--caramel`    | `#b9703f` | Wood highlight, coffee                          |
| `--toffee`     | `#d99a5b` | Light wood, crema                               |
| `--butter`     | `#f3d58a` | Lamp light, glow, selected state fill           |
| `--foam`       | `#fcefd9` | Ticket paper, panels                            |
| `--white`      | `#fffaf0` | Highlights, milk, timer digits on dark scenes   |
| `--strawberry` | `#e58a9a` | Primary action, checked todo, accents           |
| `--berry`      | `#b8526a` | Pressed/hover of primary, destructive           |
| `--matcha`     | `#86a85c` | Success, running state, plants                  |
| `--moss`       | `#4f6b4a` | Dark plants, matcha shade                       |
| `--dusk`       | `#3d4a6b` | Top bar chips, evening skies                    |
| `--night`      | `#232a44` | Night skies, scrims                             |
| `--sky`        | `#8fb7c9` | Day skies, glass, ice                           |
| `--ember`      | `#e8743b` | Fire, warning, thai tea                         |

Strawberry and matcha are the two accents. Do not introduce orange/terracotta
as a UI accent; `--ember` is for art only. A drink sprite may add at most two
colours outside the palette. Text on `--foam` is `--ink` (never grey).

## Type

One pixel face, **Jersey 25**, self-hosted through `@fontsource` (no requests
to third parties at runtime). It is tall and condensed, and its digits stay
legible at small sizes, which matters for a timer. (Pixelify Sans was tried
for body text and dropped: its 5 reads as an S.)

- Timer digits are the biggest thing on the page: `clamp(72px, min(20vw, 18vh), 240px)`
  (`--t-timer`), so they grow with the window but leave room for the scene.
- Body text is never below 20px.

Scale: 20 / 25 / 30 / 40 / timer. Sentence case everywhere. No all-caps
labels, no letter-spacing tricks, no italic.

## Pixel rules for UI chrome

- `--px: 3px` is one "art pixel". Borders are `var(--px) solid var(--ink)`.
- No `border-radius`. Corners are either square or stepped by one art pixel
  (use the `.pixel-corners` utility from `global.css`).
- Shadows are hard: `var(--px) var(--px) 0 var(--ink)`. No blur, no grey.
- Pressed buttons move down-right by one art pixel and lose the shadow.
- Spacing comes from `--s1`..`--s6` (6, 12, 18, 24, 36, 48px — multiples of
  the art pixel).
- No gradients, glass blur or drop shadows in UI. Soft glow is allowed only
  inside background scenes.
- Focus ring: `var(--px)` solid `--butter` outline offset by one art pixel,
  on every interactive element.

## Layout

The background scene is always full-bleed behind everything.

Setup, desktop (≥ 900px): the ticket is a fixed 432px column, left-aligned
with a 48px margin; the scene stays visible to the right. Content inside the
ticket is left-aligned.

```
+--------------------------------------------------------------+
| cafe name                      [clocks v] [scene] [mute] [*] |
|  +--------------------+                                      |
|  | o  order ticket  o |                                      |
|  | How long?          |          (background scene)          |
|  | [5][15][30][60]    |                                      |
|  | ----slider---- 25  |                                      |
|  | Rounds  - 1 +      |                                      |
|  | What are you having|                                      |
|  | [][][][]           |                                      |
|  | [][][][]           |                                      |
|  | [  Start brewing ] |                                      |
|  |~~~~~ torn edge ~~~~|                                      |
|  | To do              |                                      |
|  | [ ] ...            |                                      |
|  +--------------------+                                      |
+--------------------------------------------------------------+
```

Setup, phone: ticket is full width minus 12px gutters, scene peeks out for the
top 48px. The start button stays reachable without scrolling past the todos
(it sits above the torn edge).

Timer, desktop (1376px and wider): the receipt (todos) is docked top-left under
the café wordmark at 320px, and collapses to its bar (the choice is remembered
across reloads). The digits, brew scene (glass + baristas on a serving board)
and controls form one column centred on the whole window, not on the space
beside the receipt. The header (digits + status, or the "ready" heading) has a
fixed height, so the scene stays put when the drink is done.

```
+--------------------------------------------------------------+
| cafe name                      [clocks v] [scene] [mute] [*] |
| +-----------------+                                          |
| | To do · 2 left ^|            24:59                          |
| | [x] ...         |         round 1 of 3                     |
| | [ ] ...         |                                          |
| +-----------------+       o  |~~~|  o                        |
|                          /|\ |   | /|\                       |
|                    ======= counter =======                   |
|                   [ pause ]      [ leave ]                   |
+--------------------------------------------------------------+
```

1376px is the 640px column plus a 24px gutter, the 320px receipt and a 24px gap
on each side, so the docked panel never overlaps the column. Below that
(including phones) the receipt becomes the bottom sheet described next, and
always starts closed.

Timer, phone: digits, brew scene, controls stacked; the receipt is a bottom
sheet collapsed to one line ("3 left") that expands on tap.

## Pixel art rules (sprites and scenes)

- Art is SVG made of `<rect>`s on an integer grid, with
  `shape-rendering="crispEdges"`. No paths with curves, no strokes, no SVG
  filters, no gradients inside sprites. Merge runs of same-colour pixels into
  one rect to keep files small.
- Grids: drink sprite 32×48, barista 16×16, big glass 48×72, background scene
  320×180. Display at integer multiples where possible; backgrounds use
  `preserveAspectRatio="xMidYMid slice"` to cover the viewport.
- Sprites have a one-pixel `--ink` outline; background scenes have no outlines.
- Light comes from the upper left. At most three tones per material
  (shade, base, highlight). Dither only on large flat areas, sparingly.
- Sprite animation uses `steps()` timing, 2–4 frames, and only `transform`
  and `opacity`. Ambient scene motion (flicker, rain, steam, swaying) is slow
  and small; at most ~12 animated elements per scene.
- Soft glows in scenes are separate absolutely-positioned CSS layers
  (radial-gradient, `mix-blend-mode: screen`), not part of the SVG.
- Under `prefers-reduced-motion: reduce`, ambient and sprite motion stop; the
  glass still fills.

## Voice

Plain, sentence case, short. Café words only where they are obvious:
"Start brewing", "Your latte is ready", "Another round", "Same again",
"Leave". Errors say what happened and what to do. No exclamation marks, no
emoji.

## Things that are not allowed

Rounded cards, blurred shadows, gradient buttons, glassmorphism, emoji as
icons, grey text, all-caps eyebrow labels, entrance animations on load,
hover animations on every element.
