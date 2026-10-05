# GymBot

An AI workout coach: live workout logging with set check-offs and rest timer, Autopilot progression targets, form checks from video, history import from other apps, muscle maps, goal forecasts, a coach that checks in after workouts, and non-gym activities.

The app is a single React file (`src/gymbot.jsx`) that runs as a **Claude.ai artifact**, so friends can use it with no server and no API costs to the creator: each person uses their own Claude account. Haim's own copy runs the same file on Cloud Run behind a Python backend that stores the data and answers AI calls with Gemini.

## Quick start

```bash
npm install && uv sync
npx playwright install chromium      # for the browser tests
gcloud auth application-default login   # once, for real coach replies (Gemini in the mygymbot project)
npm run dev                          # http://localhost:5173, bundle rebuilds on save, data in data/dev.json
```

`web/shims.js` stands in for claude.ai: `window.storage` goes to the Python server (`server/`), which keeps it in a JSON file (`data/`, gitignored, with a daily backup in `data/backups/`), and Claude calls go to `/api/messages`, which the server answers with Gemini in the same reply shape. Without Google credentials the server sends a placeholder reply. Tailwind comes from the Play CDN, so the page needs internet for styling.

## Hosted copy (Cloud Run)

Haim's own copy runs on Cloud Run (project `mygymbot`, region `me-west1`) from the `Dockerfile`; AI is Gemini on Vertex AI through the service account, and its data is `gymbot.json` in the private, versioned bucket `gs://mygymbot-data`. Ship a change with `npm run deploy`. Open it once with the access link, `https://<service url>/?key=<key>`; the key is the `gymbot-access-key` secret.

To move a history out of claude.ai: Goals → Your data → Export data, save the text as `gymbot.json`, and `gcloud storage cp gymbot.json gs://mygymbot-data/gymbot.json --project=mygymbot`.

One-time setup (the bucket is done; the secret and first deploy are pending):

```bash
gcloud storage buckets create gs://mygymbot-data --project=mygymbot --location=me-west1 --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://mygymbot-data --project=mygymbot --versioning   # plus a lifecycle rule: delete old versions after 30 days
# secret gymbot-access-key; the compute service account gets secretAccessor on it, objectUser on the bucket, and aiplatform.user on the project
gcloud run deploy gymbot --source . --project=mygymbot --region=me-west1 --max-instances=1 --allow-unauthenticated \
  --execution-environment=gen2 --add-volume=name=data,type=cloud-storage,bucket=mygymbot-data --add-volume-mount=volume=data,mount-path=/data \
  --set-secrets=GYMBOT_ACCESS_KEY=gymbot-access-key:latest
```

## Tests

```bash
npm test             # JS unit tests for the app's pure logic
npm run test:server  # Python tests: storage, access gate, Gemini translation (no network)
npm run test:e2e     # browser tests: live workout, history edit, activities, check-in, video links, Today card, export
npm run test:all     # all three
```

Browser tests start the Python server with seeded data (`tests/fixtures.mjs`) and run on a Pixel 5-sized screen with a fixed clock (Sat 3 Oct 2026, 18:00) and a fake AI that records every request.

## Layout

```
src/gymbot.jsx      the app (the only file that ships to claude.ai)
web/                the page around it for the hosted copy: entry point, storage and AI shims (bundled to web/dist/)
server/             Python backend (FastAPI): static files, storage, Gemini, access gate
pyproject.toml      Python dependencies (uv)
Dockerfile          the hosted copy: Node builds the bundle, Python serves it
data/               your data when run locally (gitignored)
tests/              JS unit tests (load-app.mjs bundles the app so its functions can be called), server/ (pytest), e2e/ (browser), fixtures
docs/DESIGN.md      data model, architecture, AI touchpoints, decision log, known limitations
docs/ROADMAP.md     next steps, standalone app plan, monetization notes
CLAUDE.md           working rules for Claude Code
```
