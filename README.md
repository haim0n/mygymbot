# GymBot

An AI workout coach: live workout logging with set check-offs and rest timer, Autopilot progression targets, form checks from video, history import from other apps, muscle maps, goal forecasts, a coach that checks in after workouts, and non-gym activities.

It runs as a single-file **Claude.ai artifact** (`src/gymbot.jsx`), so it can be shared with friends with no server and no API costs to the creator: each person uses their own Claude account. This repository adds a local dev harness and tests around that file.

## Quick start

```bash
npm install
npx playwright install chromium      # for the browser tests
npm run dev                          # http://localhost:5173, rebuilds on save, test data in data/dev.json
ANTHROPIC_API_KEY=sk-ant-... npm run dev   # same, with real coach replies
npm start                            # http://localhost:8080, your real data in data/gymbot.json
```

Locally, `dev/shims.js` stands in for claude.ai: `window.storage` is backed by a JSON file on the server (`data/`, gitignored, with a daily backup in `data/backups/`), and Claude calls go to `/api/messages` on the server, which adds your API key server-side (it never reaches the browser). Tailwind comes from the Play CDN, so the page needs internet for styling.

To move your history out of claude.ai: Goals → Your data → Export data, then save the text as `data/gymbot.json` (while `npm start` is stopped).

## Tests

```bash
npm test          # unit tests for the pure logic
npm run test:e2e  # browser tests: live workout, history edit, activities, check-in, video links, Today card, export
```

Browser tests run on a Pixel 5-sized screen with a fixed clock (Sat 3 Oct 2026, 18:00), seeded data (`tests/fixtures.mjs`) and a fake Claude that records every request.

## Layout

```
src/gymbot.jsx      the app (the only file that ships)
dev/                local server (file storage + Claude proxy), storage shim, entry point
data/               your data when run locally (gitignored)
tests/              unit tests (load-app.mjs bundles the app so its functions can be called), browser tests, fixtures
docs/DESIGN.md      data model, architecture, AI touchpoints, decision log, known limitations
docs/ROADMAP.md     next steps, standalone app plan, monetization notes
CLAUDE.md           working rules for Claude Code
```
