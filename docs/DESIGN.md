# GymBot design

## 1. What it is

A phone-first AI workout coach. Core loop: **plan** (Autopilot targets, schedule) → **train** (live workout with check-offs and rest timer) → **reflect** (highlights, check-in with the coach, progress, forecasts). Gym lifts and non-gym activities (running, swimming, yoga, Pilates and more) share one history.

Users: Haim and friends (dogfooding), later the public.

## 2. Runtime

`src/gymbot.jsx` is a single React component file running as a **Claude.ai artifact**:

| Need | How the artifact gets it |
|---|---|
| Persistence | `window.storage` (async key-value, personal scope per user) through `usePersistentState` |
| AI | `fetch` to the Anthropic Messages API without a key; usage counts against the *viewer's* Claude plan |
| Styling | Tailwind core utility classes (prebuilt; no arbitrary values or opacity modifiers) |
| Libraries | react, recharts, lucide-react 0.383.0, papaparse |

Consequences: no server, no API costs for the creator, every user's data private to their account, no notifications while the app is closed, and no access to other users' data (including for migration).

Haim's own copy runs the same file on Cloud Run behind a Python (FastAPI) server in `server/` (`Dockerfile`, `npm run deploy`): `window.storage` becomes `<user>.json` in a mounted, versioned bucket (also copied daily at startup), the app's Claude calls are answered by Gemini on Vertex AI (`server/gemini.py` translates the Anthropic request and reply shapes, so the app is unchanged), and users sign in with Google through Identity-Aware Proxy, whose access list is the allowlist; the server verifies IAP's signed identity on every request and keeps one file per email, so storage is per user while the page and the AI are shared. One instance at most, so there's one writer; during a deploy the old and new revisions briefly overlap. Goals → Your data exports every `gymbot:*` key in that same file format, so a history can move from claude.ai to this copy.

## 3. Data model

All dates are local `YYYY-MM-DD` strings. Weights are stored in the unit chosen when they were logged (`kg` or `lb`); dumbbell weights are per dumbbell; `0` means bodyweight.

```ts
type Workout = {
  id: string;
  date: string;
  exercises: { name: string; sets: { weight: number; reps: number }[] }[]; // gym lifts, in the order done
  activities?: Activity[];   // non-gym; an activity-only entry has exercises: []
  notes: string;
  source?: "import";
  checkIn?: { effort: "Easy" | "Just right" | "Hard" | "Too much"; pain: "No" | "A little" | "Yes"; note: string; reply: string } | { skipped: true };
};

type Activity = {
  id: string;
  type: "Running" | "Walking" | "Hiking" | "Cycling" | "Swimming" | "Rowing" | "Yoga" | "Pilates" | "Other";
  minutes: number;
  distance: number | null;
  distanceUnit: "km" | "mi" | "m" | "yd" | null; // explicit, so mixed units never get confused
  effort: "Easy" | "Moderate" | "Hard" | null;
};

type Settings = {
  profile: {
    unit: "kg" | "lb"; bodyweight: string; experience: string; daysPerWeek: number; focus: string;
    coachStyle: "Encouraging" | "Hype" | "Calm" | "Tough love";
    notes: string;            // injuries and equipment
    foodNotes: string;        // food preferences
    trainingDays: number[];   // Date.getDay() numbers (0 = Sunday)
    trainingTime: string;     // "HH:MM" or ""
  };
  goals: { id: string; exercise: string; target: number /* est. 1RM */; deadline: string }[];
  repRanges: Record<string, [number, number]>; // explicit per-exercise overrides
};

type Session = { // the workout in progress
  date: string; startedAt: number | null; notes: string;
  exercises: { id: string; name: string; rest: number /* s */; sets: { id: string; weight: number | string; reps: number | string; done: boolean }[] }[];
}; // weights/reps may be strings while typed; sessionToWorkout() turns them into numbers
```

Storage keys (all personal scope):

| Key | Contents |
|---|---|
| `gymbot:workouts` | `Workout[]` |
| `gymbot:settings` | `Settings` |
| `gymbot:session` | `Session \| null` |
| `gymbot:chat` | last 60 coach messages `{ role, content }` |
| `gymbot:form-checks` | last 30 `{ id, date, exercise, feedback }` |
| `gymbot:daily-note` | `{ key: "date\|style", text }` (one coach note per day) |
| `gymbot:muscle-map` | coach classifications for exercises the rules don't know |

A stale `gymbot:video-guides` key may exist from an earlier version that searched the web; nothing reads it.

## 4. Architecture

One file, ordered so each section only depends on the ones above it:

1. **Config**: every tunable number, list and table (rep ranges, equipment steps, rest times, muscle rules, video library, activity types, forecast thresholds).
2. **Prompts**: the 8 system prompts.
3. **Persistence** (`usePersistentState`), **Claude client** (`askClaude`, `askClaudeForJson`), **Media** (frames, tiles, image decoding).
4. **Pure domain logic**: Dates & formatting, Training domain, Autopilot, Motivation, Muscles, Live workout, Schedule/check-ins/forecasts, Activities, Import, Coach context.
5. **UI**: primitives, feature components, tabs, rest timer, `GymBot` (App).

App-level state: workouts, settings, chat, form checks, session, rest timer, open details sheet, and the derived values (`records`, `plans`, `coachContext`, Today facts, daily note, learned muscles). `ExerciseContext` gives every thumbnail the learned muscles and the details-sheet opener without passing them down.

## 5. Features and the rules behind them

### Autopilot (double progression), `buildAutopilotPlans`
- **Working sets** are the sets at the session's top weight; lighter warm-up and back-off sets are ignored.
- **Rep range**: the user's override, otherwise inferred. Take the median working-set reps over the last 8 sessions and pick the preset (3–5, 3–6, 5–8, 6–10, 8–12, 10–15, 12–20) whose midpoint is closest. This stays stable while the user follows the targets, because a full cycle from the bottom to the top of a range has that range's midpoint as its median (tested over 15 sessions).
- **Rules**, in order:
  - More than 21 days since last time: **deload** (×0.9).
  - Every set hit the top of the range: **add weight**, reps back to the bottom.
  - No set below the bottom: **add reps** (lowest + 1).
  - Missed the bottom two sessions running at the same weight: **deload**.
  - Otherwise: **repeat**.
- **Weight steps** come from the equipment, read from the name. All of them land on weights that exist:

  | Equipment | Step |
  |---|---|
  | Barbell | 2.5 kg (5 lb) |
  | Squat, deadlift, leg press, hip thrust | 5 kg (10 lb) |
  | Dumbbell | 2 kg (5 lb) |
  | Kettlebell | 4 kg (5 lb) |
  | Machine, cable | 5 kg (10 lb) |
  | Bodyweight | added load |

- **Rest** comes from the top of the rep range (6 reps or fewer: 3:00, up to 10: 2:00, up to 15: 1:30, more: 1:00), plus 1:00 for big lower-body lifts.
- Only exercises trained in the last 56 days get a plan.

### Live workout
- **Starting:** with all of Up next, by repeating the last *gym* workout (same order), or empty.
- **Up next** lists only exercises not yet in the workout (Add, Add all).
- **Sets:** editable weight and reps; ✓ marks a set done and starts rest automatically (except after the final set).
- **Reordering** happens in a compact list, so a moved exercise doesn't jump out from under the finger.
- **Saving:** the session is persisted (survives tab switches and reloads). Finish saves only checked sets.
- **History** reuses the same cards to edit a saved workout (`workoutToSession` → edit → `sessionToWorkout(…, { allSets: true })`).

### Motivation
- **Today card (Coach tab).** Facts, most actionable first, up to 4 shown:
  - planned or late workout, or a rest day
  - a check-in waiting to be answered
  - a nudge if it's been a while (only when no schedule is set)
  - new bests this week
  - earned weight increases
  - goals within 10% of the target, or due within 14 days
  - a streak of 2+ weeks
  - progress toward this week's target
- **Daily note.** One coach note per day per coaching style, cached. On a planned day it's a pep talk naming a target.
- **After saving.** "Session saved" highlights: new bests, earned increases, milestones, weekly target, and for activities pace and "longest yet."
- **Weekly target and streak** count *training days* (distinct dates).

### Check-in
The latest workout from the last 2 days gets a "How did it go?" card: effort, pain and an optional note. It stays until answered or skipped. The coach replies with something session-specific, a recovery tip and a meal idea, and pain gets rest plus "see a professional if it persists". Answers are stored on the workout and included in the coach context.

### Forecasts
- **Method:** least-squares line through the best estimated 1RM per session over the last 84 days.
- **When there's no date:** fewer than 3 sessions spanning 2 weeks ("log more"), under 0.1 kg a week ("flat"), or more than a year away.
- **Output:** the date compared with the goal's deadline, and the weekly gain needed if behind.
- **Labelled rough:** gains slow as people get stronger.

### Muscles
- **Mapping:**
  - 14 groups, mapped from exercise names by ordered regex rules (`MUSCLE_RULES`; specific patterns first, e.g. reverse fly before fly).
  - Unknown names go to the coach in batches of 20, and the answer is cached.
- **Visuals:**
  - Thumbnails zoom into the main muscles (`MUSCLE_FOCUS` boxes): red for main, light red for helpers.
  - Tapping opens a details sheet with the front and back figure, main and helper muscles, equipment and video.
  - The Progress heatmap counts the last 7 days of sets, with helper muscles at half weight.
- **Original figures:** the body drawings are original and simplified. Commercial anatomy illustrations like those in other apps would need a license.

### Video guides
- **Library:** a fixed `VIDEO_LIBRARY` of 36 exercises, each linked to tutorials from established coaches.
- **Matching:** by regex after name cleanup. Exercises it doesn't cover get no video.
- **Coach recommendations:** the coach writes `[video: Exercise]` tags, the app resolves them against the library, and anything else, including raw URLs, is never made into a link.

### Import
- **CSV:**
  - Parsed with PapaParse.
  - Strong and Hevy layouts are detected locally from their column names.
  - Other layouts: the coach maps the columns from the header plus 5 sample rows, and the parsing stays local.
  - Clean-up: warm-ups and rows without reps are dropped, lb and kg are converted (to the nearest 0.5), "(Barbell)" is stripped from names, and duplicates are removed by fingerprint.
  - A paste-CSV fallback covers phones where the file picker doesn't work.
- **Screenshots:**
  - Tall captures are cut into 900×1300 px tiles with an 80 px overlap, rather than shrunk until the text is unreadable.
  - One request per screenshot, answering in compact `[weight, reps]` pairs.

### Form check
- **Video:** 6 frames sampled evenly across the set.
- **Photos:** up to 6, each scaled to a maximum side of 768 px.
- **Feedback:** a structured reply (verdict, what's good, fix first, also watch, safety), with the last 30 checks saved.

### Activities
- **Logging:** a type picker that stays small until a type is picked. Minutes, plus distance where it makes sense: km or mi following the units, m or yd for swimming, m for rowing. Effort and date.
- **Pace:** per km or mi for running, walking and hiking; per 100 for swimming; per 500 m for rowing; km/h for cycling.
- **Describing a session in words:** the lifts go into the workout in progress, and activities are saved straight away.
- **Coach:** sees a 7-day activity summary and the activities in recent workouts.
- **Not editable yet:** delete and re-log to fix one.

### Coach context (`buildCoachContext`)
Sent with every coach chat, check-in and daily note:
- the athlete's profile, schedule and food preferences
- today's status
- goals, with forecasts
- best lifts
- Autopilot targets with rest times
- the workout in progress
- sets per muscle and activities, both over the last 7 days
- the 40 most recent workouts, with check-ins

The chat sends the last 12 messages.

## 6. AI touchpoints

| Prompt | Used for | Notes |
|---|---|---|
| `COACH_PROMPT` | Coach chat | Includes video-tag rules, food rules, coaching style |
| `LOG_PARSER_PROMPT` | "Describe what you did" | Returns exercises + activities as JSON |
| `FORM_PROMPT` | Form check | Frames or photos as images |
| `COLUMN_MAPPER_PROMPT` | Unknown CSV layouts | Only header + 5 rows leave the device |
| `SCREENSHOT_IMPORT_PROMPT` | Screenshot import | Tiles of one screenshot per request |
| `MUSCLE_CLASSIFIER_PROMPT` | Unknown exercises | Batches of 20, cached |
| `MOTIVATION_PROMPT` | Daily note | Once a day per style, cached |
| `CHECK_IN_PROMPT` | Post-workout check-in reply | Stored on the workout |

All JSON answers go through `askClaudeForJson`, which reads the outermost `{…}` so extra prose or code fences don't break parsing.

## 7. UI map

- **Coach:** Today card (note and facts) · chat with quick prompts (incl. "What should I eat today?") · input fixed above the tab bar.
- **Log:** Import history (toggle) · Session saved · check-in card · coach reply · Workout or Start a workout · Log an activity · Up next · Add exercises (describe in words, or manual) · History (folded).
- **Form:** exercise, focus note, file picker, frames, feedback, past checks.
- **Progress:** stats · Activities (last 7 days) · muscle heatmap · estimated 1RM chart with trend line · weekly volume · best lifts.
- **Goals:** goal cards (barbell loaded with plates you've lifted, forecast) · new goal · About you (units, bodyweight, experience, sessions per week, training days, usual time, food preferences, coaching style, main focus, injuries and equipment). · Your data (export as text)
- **Everywhere:** rest timer bar (top), tab bar with a dot while a workout is in progress, exercise details sheet.

## 8. Decision log

| Decision | Why |
|---|---|
| Single-file artifact | Friends can use it with no server or API cost to the creator |
| Rules instead of AI for Autopilot, forecasts, muscle rules, video lookup | Instant, offline, same answer every time; trustworthy between sets |
| Video library instead of web search | No runtime search; the AI can't invent links |
| `createImageBitmap` for images; `data:` fallback for video | The sandbox blocks `blob:` URLs |
| Screenshot tiles instead of shrinking | Shrinking a 1272×4915 capture to 768 px made "11" and "7" unreadable |
| One request per screenshot | Answers are capped at 1000 tokens |
| Invisible real file input over the drop zone, plus paste-CSV | Labels forwarding to hidden inputs fail in in-app browsers |
| Session state in App, persisted | Tab switches unmount tabs; the debounced save would be lost |
| Reorder in a compact list | Tall cards moved out from under the finger, so repeated taps hit other exercises |
| Up next hides exercises already in the workout | Users read Up next as "today's workout" and couldn't edit it |
| Rep range inferred by midpoint matching | Follows how the user trains and doesn't drift as they progress |
| Equipment-based weight steps | 46.5 kg dumbbells don't exist |
| Weekly target counts training days | A gym session and a swim on the same day are one day |
| Explicit `distanceUnit` on every activity | Units can differ between sports and users |
| Original simplified figures | Commercial exercise illustrations need a license |
| Hosted backend in Python, front end stays JS | Haim works in Python; the app file must stay a JS artifact |
| Gemini on Vertex AI for the hosted copy, behind the app's Claude request shape | Billed to the `mygymbot` project with no API key; the artifact keeps calling Claude unchanged |
| Hosted users: Google sign-in through IAP, IAP's IAM list as the allowlist, one data file per email | No login screen, passwords or user table to build; adding or removing someone is one IAM change; the app and its storage keys stay unchanged |

## 9. Known limitations

- **No notifications** while the app is closed (it's a web artifact). Calendar reminders are the workaround.
- **Hosted copy: a save that fails offline is only retried by the next change.** Losing signal and then closing the tab loses what was logged since the last successful save.
- **Changing kg/lb doesn't convert** past entries.
- **Activities can't be edited** (delete and re-log).
- **Video links weren't verified as still online.** YouTube blocks automated checks. Each is one line in `VIDEO_LIBRARY`.
- **Forecasts are straight lines** and get optimistic as gains slow.
- **Simplified body figure:** 14 muscle groups, and it doesn't show the movement itself.

## 10. Testing

- `npm test`: unit tests for Autopilot, equipment steps, rep-range stability, rest, import, muscle rules, video library, live workout, forecasts, schedule and check-ins, activities and highlights. `tests/load-app.mjs` bundles the app with an extra export line and empty stand-ins for UI libraries.
- `npm run test:server`: pytest for the backend: storage round-trip, daily backup, corrupt-file refusal, access gate, Claude-to-Gemini translation, and errors becoming 502 (no network).
- `npm run test:e2e`: Playwright on a Pixel 5-sized screen with a fixed clock (Sat 3 Oct 2026, 18:00), seeded storage, and a fake Claude that records requests. Each test starts the Python server with its own seeded data file. Covers live workout (reorder, check-off, reload, finish), history edit, activities, check-in, video-tag resolution, the Today card and export.
