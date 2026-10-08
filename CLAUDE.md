# GymBot

AI workout coach: a React front end on Cloud Run, behind a **Python backend** that stores each user's data and answers AI calls with **Gemini**. Haim and invited friends dogfood it; a standalone, publicly available app comes later. Full design: `docs/DESIGN.md`. Plans: `docs/ROADMAP.md`.

## Commands

```bash
npm install && npx playwright install chromium && uv sync   # once
npm run dev          # http://localhost:5173: bundle rebuilds on save, Python server, one user (dev), data in data/dev.json
npm test             # JS unit tests for the app's pure logic (fast, no browser)
npm run test:server  # Python tests for the backend (uv run pytest)
npm run test:e2e     # builds, then browser tests on a Pixel 5-sized screen with a fake AI
npm run deploy       # ship to Haim's hosted copy on Cloud Run (only after npm run test:all passes)
```

## Layout

- `src/`: the app (JS, front end only).
  - Domain modules at the top level (`config.js`, `autopilot.js`, `workout.js`, ...): pure functions and constants, no JSX, nothing from `src/ui/`. `storage.js` and `ai.js` are the only ones that talk to the server.
  - `src/ui/*.jsx`: the components, one file per area; `App.jsx` holds the app state and the tabs.
- `web/`: the page (`index.html`), entry point (`main.jsx`), `styles.css` and `static/` (the manifest and icon that let a phone install the app), built to `web/dist/` by esbuild and Tailwind (`tailwind.config.js`).
- `server/`: the Python backend (FastAPI): serves `web/`, stores each user's data (`storage.py`), answers AI calls with Gemini (`gemini.py`), and identifies users from IAP (`iap.py`). **Backend code is Python only.**
- `tests/`: `domain.test.mjs` (imports the domain modules directly), `server/` (pytest), `e2e/` (Playwright driving the Python server).

Run `npm test` after any logic change and `npm run test:all` before handing work back.

## Front end rules

- **Imports keep their extension** (`./dates.js`, `./ui/log.jsx`): Node runs the unit tests on the domain modules as they are. Domain modules never import UI.
- **Libraries**: react, recharts, lucide-react (pinned at 0.383.0; newer icon names don't exist in it), papaparse. Add one only when a few lines of code won't do.
- **Storage**: persist through `usePersistentState` (`storage.js`: one JSON value per key on the server, writes debounced 300 ms). A read that fails is retried, never taken as "nothing stored", or the app would save its defaults over the user's data. State that must survive tab switches lives in `App.jsx`, not in a tab. No localStorage.
- **AI**: `askAI` / `askAIForJson` (`ai.js`) post `{ system, messages: [{ role, content, images? }] }` to `/api/ask` and get `{ text }`; images are base64 JPEG. The server answers with Gemini (`server/gemini.py`).
- **The AI never produces links.** Video recommendations are `[video: Exercise]` tags resolved against `VIDEO_LIBRARY`; suggested workout plans are `[plan: Name: Exercise, ...]` tags and a new athlete's profile a `[profile: field: value; ...]` tag, each shown with a Save button; `[import]` is a button that opens Import history; `[remember: fact]` is kept in `settings.coachMemory` and shown in Goals.
- **File inputs**: the real `<input>` sits invisibly over its drop zone (`FilePicker`); a `<label>` forwarding taps to a hidden input fails in in-app browsers.
- **Styling**: Tailwind (v3) utility classes. `npm run build` writes only the classes it finds in `src/` to `web/dist/app.css`, so write class names whole (`"bg-blue-700"`, never `` `bg-${color}-700` ``).

## Conventions

- **Simplicity and readability first; clean data architecture second.**
- Domain logic is pure functions (no React, no I/O) in the domain modules. New logic goes there and gets a test in `tests/domain.test.mjs`.
- Tunable numbers are named constants in `config.js` with a comment saying what they mean. Prompts live in `prompts.js`.
- Deterministic rules wherever an answer must be consistent (Autopilot, forecasts, muscle rules, video lookup). Use the AI for language, images and unknown inputs, and cache what it classifies.
- **Version**: `APP_VERSION` in `config.js` (shown at the bottom of Goals) and `version` in `package.json` stay equal (a unit test checks). Bump both for every release, i.e. before a deploy that changes the app. The hosted copy also shows the git commit it was deployed from (`npm run deploy` sets `GYMBOT_COMMIT`, the server puts it in the page), with `-dirty` if there were uncommitted changes, so deploy after committing.
- Stored data stays backward compatible: new fields are optional and read with defaults (`profile.trainingDays ?? []`). Never rename storage keys without a migration.
- Comments explain *why*. Names are full words.
- UI: mobile first (393 px wide), sentence case, plain words, no exclamation marks, no middle-dot separators. Small by default, expand on tap.
- Haim codes mostly in Python and likes Polars: all backend and analytics code is Python (uv, type hints, reST docstrings, dataclasses); JS is only for the front end.

## Code map (`src/`)

- **Server access**: `storage.js` (`usePersistentState`, export), `ai.js` (`askAI`), `media.js` (video frames, screenshot tiles).
- **Domain**: `config.js` · `prompts.js` · `dates.js` (dates and formatting) · `training.js` (records, volume, exercise names, video and photo lookup) · `autopilot.js` · `motivation.js` (Today facts, highlights) · `muscles.js` · `workout.js` (live workout, workout plans, rest notes) · `schedule.js` (schedule, check-ins, forecasts) · `activities.js` · `import.js` · `coach-context.js` · `exercise-photos.js` (generated by `scripts/exercise_photos.py`; the photos are in `web/exercises/`, and `scripts/exercise_drawings.py` replaces chosen ones with Gemini drawings, listed in `scripts/drawn-exercises.txt`) · `photo-matches.js` (reviewed photos for common names; a unit test checks every id exists).
- **UI** (`src/ui/`): `primitives` · `motivation` (Today card) · `muscles` (figures, heatmap) · `videos` · `exercises` (thumbnails, details sheet) · `check-in` · `activities` · `coach` · `log` (live workout, Start a workout, Up next, history) · `import-history` · `form-check` · `progress` · `goals` (with the data export) · `rest-timer`; `App.jsx` puts them together.

## Haim's hosted copy (Cloud Run)

Haim dogfoods the app on Cloud Run: service `gymbot`, project `mygymbot`, region `me-west1`, built from the `Dockerfile` (bundle with Node, serve with Python). Each user's data is one `<email>.json` in the bucket `gs://mygymbot-data` (mounted at `/data`, versioned, plus a daily copy in `backups/`). AI is Gemini (`GEMINI_MODEL` in `server/gemini.py`) on Vertex AI through the service account; no API key. Users sign in with Google through IAP; IAP's access list (`roles/iap.httpsResourceAccessor`, see README) is the allowlist, and the server verifies IAP's signed token (`server/iap.py`) and uses the email to pick the file. Changing who has access is Haim's step (README → Letting a friend in).

- **`mygymbot` is the only GCP project to touch.** Pass `--project=mygymbot` literally on every gcloud call (the machine default is Haim's work project; `.claude/settings.json` also sets `CLOUDSDK_CORE_PROJECT`). Python passes the project and quota project explicitly.
- `gs://mygymbot-data/*.json` are real workout histories, one per email: read them freely (`gcloud storage cat`) to debug or tune; never write or delete it. Try changes with `npm run dev`.
- Ship with `npm run deploy`, only after `npm run test:all` passes. It reuses the service's settings (volume, IAP, one instance), so no extra flags.
- After a deploy, smoke-check https://gymbot-83264737603.me-west1.run.app: without signing in it redirects to Google sign-in, and the logs show the new revision started cleanly. Haim checks the signed-in app in his browser. Never write test keys to anyone's file.
- Logs: `gcloud run services logs read gymbot --project=mygymbot --region=me-west1`. Earlier versions of the data (the last 10 per file, up to 7 days old; every app save makes one): `gcloud storage ls -a 'gs://mygymbot-data/**' --project=mygymbot`. Daily copies in `backups/` are kept 30 days.
- Docker can't run on this machine (no socket access). To check the container builds without deploying, run `gcloud builds submit . --project=mygymbot --region=me-west1` with a config whose only step is `docker build`.

## Gemini notes

- `gemini-3.8-flash` at location `global`. Newer models: list `publishers/google/models` on `aiplatform.googleapis.com/v1beta1` with a gcloud access token and `x-goog-user-project: mygymbot`.
- `thinking_level="minimal"` is rejected; `"low"` is the floor. Thinking takes roughly 300 to 500 tokens on top of the answer, which `MAX_OUTPUT_TOKENS` leaves room for.
- Gemini wraps JSON answers in code fences; `askAIForJson` already cuts to the outermost `{…}`.
- With Google credentials on this machine, `npm run dev` makes real Gemini calls, billed to `mygymbot`.

## Working with Haim

- **Commit only when he says "commit"**: one commit per logical step, with a body listing what changed. Ask before creating anything billable or outward-facing.
- **He handles secrets himself** (creating them and changing who can read them; auto mode blocks those for Claude Code). Hand him the command, then verify the result read-only before continuing.
- **Commands for him to paste**: long single lines get split when pasted, so break them with a trailing `\`. For `! command`, the `!` must be the very first character, or it arrives as a chat message and nothing runs.
- **The shell is zsh**: an unquoted `$VAR` holding several words is passed as one argument. Write flags literally (a `--project` flag kept in a variable once created a bucket in his work project).
- **Verify, don't assume**: esbuild strips comments, so test a rebuild with a real code change; check cloud results by reading them back.
