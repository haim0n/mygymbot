# GymBot

AI workout coach (React). Today it runs as a **single-file Claude.ai artifact**, being dogfooded by Haim and friends; a standalone, publicly available app comes later. Full design: `docs/DESIGN.md`. Plans: `docs/ROADMAP.md`.

## Commands

```bash
npm install && npx playwright install chromium   # once
npm run dev        # http://localhost:5173, rebuilds on save. ANTHROPIC_API_KEY=... for real coach replies
npm test           # unit tests for the pure logic (fast, no browser)
npm run test:e2e   # browser tests on a Pixel 5-sized screen with a fake Claude
```

Run `npm test` after any logic change and `npm run test:all` before handing work back.

## Hard constraints: `src/gymbot.jsx` must keep running as a claude.ai artifact

- **One file**, default export `GymBot`, no local imports. `dev/` and `tests/` are scaffolding around it and never ship.
- **Libraries available in artifacts**: react, recharts, lucide-react **0.383.0** (pinned; newer icon names don't exist there), papaparse, lodash, d3, mathjs. Nothing else.
- **Tailwind core utility classes only.** No arbitrary values (`w-[37px]`) and no opacity modifiers (`bg-black/40`): use inline `style` for those.
- **No localStorage/sessionStorage.** Persist through `usePersistentState` (wraps `window.storage`, personal scope, writes debounced 300 ms). State that must survive tab switches lives in `GymBot` (App), not in a tab.
- **Claude API**: `fetch("https://api.anthropic.com/v1/messages")`, no API key, model `claude-sonnet-4-6`, `max_tokens: 1000`. Keep requests small enough that answers fit: compact JSON, one request per screenshot, classify in batches of 20.
- **Never load images or video through `blob:` URLs** (the sandbox blocks them: "The source image cannot be decoded"). Use `createImageBitmap(file)`; fall back to `data:` URLs.
- **The AI never produces links.** Video recommendations are `[video: Exercise]` tags resolved against `VIDEO_LIBRARY`.
- **File inputs**: the real `<input>` sits invisibly over its drop zone (`FilePicker`); a `<label>` forwarding taps to a hidden input fails in in-app browsers.

## Conventions

- **Simplicity and readability first; clean data architecture second.**
- Domain logic is pure functions (no React, no I/O) in the sections between "Dates & formatting" and "Coach context". New logic goes there and gets a test in `tests/domain.test.mjs` (functions are reached via `loadApp([...names])`).
- Tunable numbers are named constants in **Config** with a comment saying what they mean. Prompts live in **Prompts**.
- Deterministic rules wherever an answer must be consistent (Autopilot, forecasts, muscle rules, video lookup). Use the AI for language, images and unknown inputs, and cache what it classifies.
- Stored data stays backward compatible: new fields are optional and read with defaults (`profile.trainingDays ?? []`). Never rename storage keys without a migration.
- Comments explain *why*. Names are full words.
- UI: mobile first (393 px wide), sentence case, plain words, no exclamation marks, no middle-dot separators. Small by default, expand on tap.
- Haim codes mostly in Python and likes Polars: prefer them for any future backend or analytics work.

## Code map (sections of `src/gymbot.jsx`, in file order)

Config · Prompts · Persistence · Claude client · Media · Dates & formatting · Training domain · Autopilot · Motivation · Muscles · Live workout · Schedule, check-ins & forecasts · Activities · Import · Coach context · UI primitives · Motivation UI · Muscle visuals · Video guides · Exercise thumbnails & details · Check-in · Activities UI · Coach · Log (Live workout UI, Import history) · Form check · Progress · Goals · Rest timer · App

Each section starts with a `/* ──── Name ──── */` banner; search for it.

## Deploying a change to claude.ai

Upload `src/gymbot.jsx` to a chat in the **CustomWorkout** project and ask Claude to present it as an artifact; share or publish it from there. Friends' data stays in their own Claude accounts (personal storage), so storage keys and data shapes must stay compatible between versions.
