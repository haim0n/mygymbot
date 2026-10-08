# GymBot

An AI workout coach: live workout logging with set check-offs and rest timer, Autopilot progression targets, form checks from video, history import from other apps, muscle maps, goal forecasts, a coach that checks in after workouts, and non-gym activities.

A React front end (`src/`) runs on Cloud Run behind a Python backend that stores each user's data and answers AI calls with Gemini. Haim and invited friends sign in with Google.

## Quick start

```bash
npm install && uv sync
npx playwright install chromium      # for the browser tests
gcloud auth application-default login   # once, for real coach replies (Gemini in the mygymbot project)
npm run dev                          # http://localhost:5173, bundle rebuilds on save, data in data/dev.json
```

Locally there's one user, `dev`: the Python server (`server/`) keeps the data in a JSON file (`data/`, gitignored, with a daily backup in `data/backups/`) and answers AI calls (`/api/ask`) with Gemini. Without Google credentials it sends a placeholder reply.

## Hosted copy (Cloud Run)

Haim's own copy runs on Cloud Run (project `mygymbot`, region `me-west1`) from the `Dockerfile`; AI is Gemini on Vertex AI through the service account, and each user's data is `<their email>.json` in the private, versioned bucket `gs://mygymbot-data`. It lives at https://gymbot-83264737603.me-west1.run.app. Ship a change with `npm run deploy`.

Users sign in with their Google account through Identity-Aware Proxy (IAP). IAP's access list is the allowlist; the server checks IAP's signed identity on every request and gives each email its own file.

### Letting a friend in

No deploy is needed, and it works for any Google account (Gmail or not).

1. **Get the email of the Google account they'll sign in with.** It has to be exactly that account; any other one gets "You don't have access".
2. **Bring their claude.ai history over (optional, and before their first visit).** GymBot used to run as a claude.ai artifact. Friends who used it there open their copy, go to Goals → Your data → Export data, and send you the text. (Copies without an Export button need the last artifact version, `git show ade439e:src/gymbot.jsx`, uploaded to claude.ai first.) Save it as `<email>.json` (the email in lowercase) and upload it:
   ```bash
   gcloud storage cp FRIEND@gmail.com.json \
     gs://mygymbot-data/FRIEND@gmail.com.json --project=mygymbot
   ```
   If they visit first, the app saves an empty profile to that file; check with them before overwriting it.
3. **Add them to the access list:**
   ```bash
   gcloud iap web add-iam-policy-binding --project=mygymbot --region=me-west1 \
     --resource-type=cloud-run --service=gymbot \
     --member=user:FRIEND@gmail.com --role=roles/iap.httpsResourceAccessor
   ```
4. **Send them the address**, https://gymbot-83264737603.me-west1.run.app. They sign in with Google; access can take a minute or two to start working. On a phone, Add to Home Screen makes it feel like an app.

Who has access now: `gcloud iap web get-iam-policy --project=mygymbot --region=me-west1 --resource-type=cloud-run --service=gymbot`.

To lock someone out, run step 3 with `remove-iam-policy-binding` instead. Their file stays in the bucket, so adding them back restores everything.

One-time setup (later deploys are just `npm run deploy`, which keeps these settings):

```bash
gcloud storage buckets create gs://mygymbot-data --project=mygymbot --location=me-west1 --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://mygymbot-data --project=mygymbot --versioning   # lifecycle: keep at most 10 old versions per file, for 7 days; daily backups/ for 30 days
# the compute service account gets objectUser on the bucket and aiplatform.user on the project
# IAP: the project has no organization, so first create the OAuth consent screen (External, published) and a web OAuth client in the console
# with redirect URI https://iap.googleapis.com/v1/oauth/clientIds/<client id>:handleRedirect (enable cloudresourcemanager.googleapis.com too),
# then hand IAP the client with `gcloud iap settings set` (resource type cloud-run); the IAP service agent gets run.invoker on the service
gcloud run deploy gymbot --source . --project=mygymbot --region=me-west1 --max-instances=1 --no-allow-unauthenticated --iap \
  --execution-environment=gen2 --add-volume=name=data,type=cloud-storage,bucket=mygymbot-data --add-volume-mount=volume=data,mount-path=/data
```

## Tests

```bash
npm test             # JS unit tests for the app's pure logic
npm run test:server  # Python tests: storage, access gate, the AI endpoint and its Gemini translation (no network)
npm run test:e2e     # browser tests: live workout, history edit, activities, check-in, video links, Today card, export
npm run test:all     # all three
```

Browser tests start the Python server with seeded data (`tests/fixtures.mjs`) and run on a Pixel 5-sized screen with a fixed clock (Sat 3 Oct 2026, 18:00) and a fake AI that records every request.

## Layout

```
src/                the app: domain modules (*.js, pure logic plus storage and AI calls), ui/ (components), App.jsx
web/                the page, entry point and styles (built to web/dist/; tailwind.config.js)
server/             Python backend (FastAPI): static files, storage, Gemini, access gate
scripts/            exercise_photos.py: fetches the public-domain exercise photos into web/exercises/
                    exercise_drawings.py: redraws chosen photos as clean illustrations with Gemini (billed)
pyproject.toml      Python dependencies (uv)
Dockerfile          the hosted copy: Node builds the bundle, Python serves it
data/               your data when run locally (gitignored)
tests/              JS unit tests (on the domain modules), server/ (pytest), e2e/ (browser), fixtures
docs/DESIGN.md      data model, architecture, AI touchpoints, decision log, known limitations
docs/ROADMAP.md     next steps, standalone app plan, monetization notes
CLAUDE.md           working rules for Claude Code
```
