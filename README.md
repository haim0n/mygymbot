# GymBot

An AI workout coach: live workout logging with set check-offs and rest timer, Autopilot progression targets, form checks from video, history import from other apps, muscle maps, goal forecasts, a coach that checks in after workouts, and non-gym activities.

It runs as a single-file **Claude.ai artifact** (`src/gymbot.jsx`), so it can be shared with friends with no server and no API costs to the creator: each person uses their own Claude account. This repository adds a local dev harness and tests around that file.

## Quick start

```bash
npm install
npx playwright install chromium      # for the browser tests
npm run dev                          # http://localhost:5173
ANTHROPIC_API_KEY=sk-ant-... npm run dev   # same, with real coach replies
```

Locally, `dev/shims.js` stands in for claude.ai: `window.storage` is backed by localStorage, and Claude calls go to `/api/messages` on the dev server, which adds your API key server-side (it never reaches the browser). Tailwind comes from the Play CDN, so the dev page needs internet for styling.

## Tests

```bash
npm test          # 12 unit tests for the pure logic
npm run test:e2e  # 6 browser tests: live workout, history edit, activities, check-in, video links, Today card
```

Browser tests run on a Pixel 5-sized screen with a fixed clock (Sat 3 Oct 2026, 18:00), seeded data (`tests/fixtures.mjs`) and a fake Claude that records every request.

## Layout

```
src/gymbot.jsx      the app (the only file that ships)
dev/                local harness: server + Claude proxy, storage shim, entry point
tests/              unit tests (load-app.mjs bundles the app so its functions can be called), browser tests, fixtures
docs/DESIGN.md      data model, architecture, AI touchpoints, decision log, known limitations
docs/ROADMAP.md     next steps, standalone app plan, monetization notes
CLAUDE.md           working rules for Claude Code
```
