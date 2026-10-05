# GymBot

AI workout coach. The app is one React file that runs as a **Claude.ai artifact** (friends dogfood it there) and, for Haim, on Cloud Run behind a **Python backend** with **Gemini**; a standalone, publicly available app comes later. Full design: `docs/DESIGN.md`. Plans: `docs/ROADMAP.md`.

## Commands

```bash
npm install && npx playwright install chromium && uv sync   # once
npm run dev          # http://localhost:5173: bundle rebuilds on save, Python server, data in data/dev.json
npm test             # JS unit tests for the app's pure logic (fast, no browser)
npm run test:server  # Python tests for the backend (uv run pytest)
npm run test:e2e     # builds, then browser tests on a Pixel 5-sized screen with a fake AI
npm run deploy       # ship to Haim's hosted copy on Cloud Run (only after npm run test:all passes)
```

## Layout

- `src/gymbot.jsx`: the whole app (JS, front end only).
- `web/`: the page around it for the hosted copy (`index.html`, `main.jsx`, `shims.js` standing in for the artifact's `window.storage` and Claude API). Built to `web/dist/` by esbuild.
- `server/`: the Python backend (FastAPI): serves `web/`, stores data (`storage.py`), answers AI calls with Gemini (`gemini.py`), and gates access (`app.py`). **Backend code is Python only.**
- `tests/`: `domain.test.mjs` (JS logic), `server/` (pytest), `e2e/` (Playwright driving the Python server).

Run `npm test` after any logic change and `npm run test:all` before handing work back.

## Hard constraints: `src/gymbot.jsx` must keep running as a claude.ai artifact

- **One file**, default export `GymBot`, no local imports. `web/`, `server/` and `tests/` are around it and never ship to claude.ai.
- **Libraries available in artifacts**: react, recharts, lucide-react **0.383.0** (pinned; newer icon names don't exist there), papaparse, lodash, d3, mathjs. Nothing else.
- **Tailwind core utility classes only.** No arbitrary values (`w-[37px]`) and no opacity modifiers (`bg-black/40`): use inline `style` for those.
- **No localStorage/sessionStorage.** Persist through `usePersistentState` (wraps `window.storage`, personal scope, writes debounced 300 ms). State that must survive tab switches lives in `GymBot` (App), not in a tab.
- **Claude API**: `fetch("https://api.anthropic.com/v1/messages")`, no API key, model `claude-sonnet-4-6`, `max_tokens: 1000`. Keep requests small enough that answers fit: compact JSON, one request per screenshot, classify in batches of 20. The hosted copy sends the same requests to the Python server, which answers them with Gemini (`server/gemini.py` translates both ways), so only text and base64 JPEG blocks are supported.
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
- Haim codes mostly in Python and likes Polars: all backend and analytics code is Python (uv, type hints, reST docstrings, dataclasses); JS is only for the front end.

## Code map (sections of `src/gymbot.jsx`, in file order)

Config · Prompts · Persistence · Claude client · Media · Dates & formatting · Training domain · Autopilot · Motivation · Muscles · Live workout · Schedule, check-ins & forecasts · Activities · Import · Coach context · UI primitives · Motivation UI · Muscle visuals · Video guides · Exercise thumbnails & details · Check-in · Activities UI · Coach · Log (Live workout UI, Import history) · Form check · Progress · Goals · Rest timer · App

Each section starts with a `/* ──── Name ──── */` banner; search for it.

## Haim's hosted copy (Cloud Run)

Haim dogfoods the app on Cloud Run: service `gymbot`, project `mygymbot`, region `me-west1`, built from the `Dockerfile` (bundle with Node, serve with Python). `window.storage` is backed by `gymbot.json` in the bucket `gs://mygymbot-data` (mounted at `/data`, versioned, plus a daily copy in `backups/`). AI is Gemini (`GEMINI_MODEL` in `server/gemini.py`) on Vertex AI through the service account; no API key. Access needs the secret link (`/?key=…`, Secret Manager `gymbot-access-key`).

- **`mygymbot` is the only GCP project to touch.** Pass `--project=mygymbot` literally on every gcloud call (the machine default is Haim's work project; `.claude/settings.json` also sets `CLOUDSDK_CORE_PROJECT`). Python passes the project and quota project explicitly.
- `gs://mygymbot-data/gymbot.json` is his real workout history: read it freely (`gcloud storage cat`) to debug or tune; never write or delete it. Try changes with `npm run dev`.
- Ship with `npm run deploy`, only after `npm run test:all` passes.

## Deploying a change to claude.ai

Upload `src/gymbot.jsx` to a chat in the **CustomWorkout** project and ask Claude to present it as an artifact; share or publish it from there. Friends' data stays in their own Claude accounts (personal storage), so storage keys and data shapes must stay compatible between versions.
