# GymBot design

## 1. What it is

A phone-first AI workout coach. Core loop: **plan** (Autopilot targets, schedule) → **train** (live workout with check-offs and rest timer) → **reflect** (highlights, check-in with the coach, progress, forecasts). Gym lifts and non-gym activities (running, swimming, yoga, Pilates and more) share one history.

Users: Haim and friends (dogfooding), later the public.

## 2. Runtime

A React front end (`src/`, bundled by esbuild) served on Cloud Run by a Python (FastAPI) server in `server/` (`Dockerfile`, `npm run deploy`):

| Need | How |
|---|---|
| Sign-in | Google accounts through Identity-Aware Proxy (IAP), whose access list is the allowlist; the server verifies IAP's signed identity on every request |
| Persistence | `usePersistentState` → `/api/storage/<key>` → one `<email>.json` per user in a mounted, versioned bucket (also copied daily at startup) |
| AI | `askAI` → `POST /api/ask` → Gemini on Vertex AI, billed to the `mygymbot` project, no API key |
| Styling | Tailwind utility classes, built to one CSS file with the bundle |
| Libraries | react, recharts, lucide-react 0.383.0, papaparse |

One instance at most, so there's one writer per file; during a deploy the old and new revisions briefly overlap. Goals → Your data exports every `gymbot:*` key in that same file format.

GymBot started as a single-file claude.ai artifact (`window.storage` and the Claude API, no server). Friends' copies there are frozen at that version; their data comes over through the export (README → Letting a friend in). Storage keys and data shapes are unchanged from that version.

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
  routine?: string;          // the workout plan it was started from (or saved as); decides which plan is next
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
    music?: string;           // what they like to train to
    trainingDays: number[];   // Date.getDay() numbers (0 = Sunday)
    trainingTime: string;     // "HH:MM" or ""
    // Optional, "" when not given; the coach sees only what is filled in.
    birthYear?: string; sex?: "" | "Female" | "Male"; height?: string /* cm, or in for lb */; sessionMinutes?: string | number;
  };
  goals: { id: string; exercise: string; target: number /* est. 1RM */; deadline: string }[];
  repRanges: Record<string, [number, number]>; // explicit per-exercise overrides
  routines?: { name: string; exercises: string[] }[]; // saved workout plans (A/B...), done in turn; "routines" in code
  coachMemory?: { text: string; date: string }[]; // facts the coach was told in chats, newest last, at most MAX_COACH_FACTS
};

type Session = { // the workout in progress
  date: string; startedAt: number | null; notes: string; routine?: string;
  coachNotes?: { exercise: string; text: string; restStartedAt: number }[]; coachQuiet?: boolean; // the coach's rest notes, and Quiet
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
| `gymbot:exercise-photos` | the photo the AI matched to each exercise without a same-named one (`null`: none fits) |

A stale `gymbot:video-guides` key may exist from an earlier version that searched the web; nothing reads it.

## 4. Architecture

Modules in `src/`, with no import cycles; domain modules import nothing from `src/ui/`:

1. **`config.js`**: every tunable number, list and table (rep ranges, equipment steps, rest times, muscle rules, video library, activity types, forecast thresholds). **`prompts.js`**: the system prompts.
2. **Server access**: `storage.js` (`usePersistentState`), `ai.js` (`askAI`, `askAIForJson`), and `media.js` (frames, tiles, image decoding) for what goes to the AI.
3. **Pure domain logic**: `dates.js`, `training.js`, `autopilot.js`, `motivation.js`, `muscles.js`, `workout.js`, `schedule.js`, `activities.js`, `import.js`, `coach-context.js`. No JSX and nothing from the UI, so the unit tests import them directly.
4. **UI** (`src/ui/`): primitives, feature components, tabs, rest timer; `App.jsx` (`GymBot`) holds the app state.

App-level state: workouts, settings, chat, form checks, session, rest timer, open details sheet, and the derived values (`records`, `plans`, `coachContext`, Today facts, daily note, learned muscles and photos). `ExerciseContext` gives every thumbnail the learned muscles and photos and the details-sheet opener without passing them down.

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
- **Coach between sets (`useRestNote`):** the first rest of each exercise gets one short line from the coach in the rest bar (`REST_NOTE_PROMPT`, under 20 words, nothing else: no sound, no extra rests). The kind rotates (`REST_NOTE_KINDS`: a cue, a question, the set's numbers, a fact), and the coach sees the coach context, the latest 6 chat messages and what it already said, so it follows up on the chat. Reply puts the note in the coach chat and opens it; Quiet stops the notes for that workout. While a workout is in progress the chat answers in 1 to 3 lines.
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
- **Daily note.** One coach note per day per coaching style, cached. On a planned day it's a pep talk naming a target. None until the first workout is logged.
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
  - Thumbnails show a photo of the exercise being done, so a beginner can find the equipment in the gym. Without a photo they zoom into the main muscles (`MUSCLE_FOCUS` boxes): red for main, light red for helpers.
  - Tapping opens a details sheet with the start and finish photos, the front and back figure, main and helper muscles, equipment and video.
  - The Progress heatmap counts the last 7 days of sets, with helper muscles at half weight.
- **Original figures:** the body drawings are original and simplified. Commercial anatomy illustrations like those in other apps would need a license.
- **Photos (`photoFor`):** 675 strength exercises from free-exercise-db (public domain), two photos each, fetched by `scripts/exercise_photos.py` into `web/exercises/` (WebP, 360 px wide, about 11 MB) with their ids in `src/exercise-photos.js`. The common ones (`PHOTO_MATCHES`, the same-name matches of common names, and the exercises in users' histories) are redrawn as illustrations by `scripts/exercise_drawings.py`: white background, grey figure, the main muscles in red, so the equipment and the muscles show at thumbnail size. Each picture is drawn from its own photo by Gemini (about $0.07 each), checked by eye, and written over the photo with the same file name; `scripts/drawn-exercises.txt` lists them so `exercise_photos.py` doesn't put the photos back. Same name first, also with the equipment moved to the front ("Bench Press (Dumbbell)" = "Dumbbell Bench Press"), then `PHOTO_MATCHES` (`src/photo-matches.js`: 143 common Strong, Hevy and coach names, matched by the AI once and reviewed, so every user gets the same photo with no AI call); other names go to the AI in batches of 20 (`EXERCISE_PHOTO_PROMPT`, same movement on the same equipment, or none), cached per user. Exercises in saved plans and the workout in progress are matched too, so a new user's first plan has photos.

### Video guides
- **Library:** a fixed `VIDEO_LIBRARY` of 36 exercises, each linked to tutorials from established coaches.
- **Matching:** by regex after name cleanup. Exercises it doesn't cover get no video.
- **Coach recommendations:** the coach writes `[video: Exercise]` tags, the app resolves them against the library, and anything else, including raw URLs, is never made into a link. Workout plans it suggests or fixes are `[plan: Name: Exercise, ...]` lines, shown with a Save plan button (same name replaces that plan). A new athlete's interview ends with a `[profile: field: value; ...]` line (name, experience, daysPerWeek, sessionMinutes, focus, notes, music; each value checked by `parseProfileTag`), shown with a Save to profile button. `[import]` is a button that opens Import history in Log. When the athlete says something that will still matter later (a preference, an injury, a schedule change), the coach adds `[remember: fact]` (or `[remember: new fact | replaces: old fact]`); the chat shows it as a small "Noted" line, `rememberFacts` keeps it in `coachMemory`, and the coach context lists those facts under WHAT YOU KNOW ABOUT THE ATHLETE.

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

### Onboarding (`isNewAthlete`)
- **Who**: no workouts and no saved plans. Saving a plan or logging anything ends it, so existing users never see it.
- **How**: the chat opens with the coach's first message (`ONBOARDING_GREETING`, no AI call): an offer to import history from another app, then the first question. `ONBOARDING_PROMPT` joins the coach context and has the coach ask one question per message (goal, experience, days a week and session length, injuries, equipment, music), then write a profile tag and the first plans, and end with one line saying that age, sex and height in About you are optional and help. The Today card then says "Your first workout is ready".

### Coach context (`buildCoachContext`)
Sent with every coach chat, check-in and daily note:
- the athlete's profile, schedule, food preferences and workout music
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
| `ONBOARDING_PROMPT` | Coach chat, new athletes only | Interview, then profile and plan tags |
| `LOG_PARSER_PROMPT` | "Describe what you did" | Returns exercises + activities as JSON |
| `FORM_PROMPT` | Form check | Frames or photos as images |
| `COLUMN_MAPPER_PROMPT` | Unknown CSV layouts | Only header + 5 rows leave the device |
| `SCREENSHOT_IMPORT_PROMPT` | Screenshot import | Tiles of one screenshot per request |
| `MUSCLE_CLASSIFIER_PROMPT` | Unknown exercises | Batches of 20, cached |
| `EXERCISE_PHOTO_PROMPT` | Exercises without a same-named photo | Batches of 20, cached, `null` when none fits |
| `REST_NOTE_PROMPT` | Rest bar during a workout | Once per exercise, kinds in turn, sees the latest chat |
| `MOTIVATION_PROMPT` | Daily note | Once a day per style, cached |
| `CHECK_IN_PROMPT` | Post-workout check-in reply | Stored on the workout |

All JSON answers go through `askAIForJson`, which reads the outermost `{…}` so extra prose or code fences don't break parsing.

## 7. UI map

- **Coach:** like a messaging app, the title, the Today card and the input stay in place and only the chat scrolls. The chat opens at the latest message and follows new ones, unless the athlete scrolled back. The Today card is one line (its first fact) until tapped; tapping the input closes it again, to keep room for the keyboard · for a new athlete, the coach's first question instead of quick prompts · quick prompts (incl. "What should I eat today?") above the input.
- **Log:** Import history (toggle) · Session saved · check-in card · coach reply · Workout (with Save as a plan) or Start a workout (saved plans, the next one first in line) · Log an activity · Up next · Add exercises (describe in words, or manual) · History (folded).
- **Form:** exercise, focus note, file picker, frames, feedback, past checks.
- **Progress:** stats · Activities (last 7 days) · muscle heatmap · estimated 1RM chart with trend line · weekly volume · best lifts.
- **Goals:** goal cards (barbell loaded with plates you've lifted, forecast) · new goal · About you (units, bodyweight, experience, sessions per week, minutes per session, birth year, sex, height, training days, usual time, food preferences, workout music, coaching style, main focus, injuries and equipment) · What your coach knows (facts from chats, edit or delete) · Your data (export as text)
- **Everywhere:** rest timer bar (top, with the coach's note, Reply and Quiet), tab bar with a dot while a workout is in progress, exercise details sheet.

## 8. Decision log

| Decision | Why |
|---|---|
| Started as a single-file claude.ai artifact | Friends could use it with no server or API cost to the creator |
| Moved to Cloud Run only, split into modules | One copy to maintain; the artifact's limits (one file, its libraries, its API) no longer apply |
| Rules instead of AI for Autopilot, forecasts, muscle rules, video lookup | Instant, offline, same answer every time; trustworthy between sets |
| Video library instead of web search | No runtime search; the AI can't invent links |
| Screenshot tiles instead of shrinking | Shrinking a 1272×4915 capture to 768 px made "11" and "7" unreadable |
| One request per screenshot | Keeps each answer short (the artifact capped answers at 1000 tokens) |
| Invisible real file input over the drop zone, plus paste-CSV | Labels forwarding to hidden inputs fail in in-app browsers |
| Session state in App, persisted | Tab switches unmount tabs; the debounced save would be lost |
| Reorder in a compact list | Tall cards moved out from under the finger, so repeated taps hit other exercises |
| Up next hides exercises already in the workout | Users read Up next as "today's workout" and couldn't edit it |
| Rep range inferred by midpoint matching | Follows how the user trains and doesn't drift as they progress |
| Equipment-based weight steps | 46.5 kg dumbbells don't exist |
| Weekly target counts training days | A gym session and a swim on the same day are one day |
| Explicit `distanceUnit` on every activity | Units can differ between sports and users |
| Original simplified figures | Commercial exercise illustrations need a license |
| Public-domain exercise photos, stored with the app | Show the equipment to find; free, no license, served behind IAP with no third party |
| Backend in Python, front end in JS | Haim works in Python; the browser runs JS |
| Gemini on Vertex AI behind the app's own `/api/ask` | Billed to the `mygymbot` project with no API key; the front end doesn't depend on the AI vendor |
| Users: Google sign-in through IAP, IAP's IAM list as the allowlist, one data file per email | No login screen, passwords or user table to build; adding or removing someone is one IAM change |

## 9. Known limitations

- **No notifications** while the app is closed (it's a web page). Calendar reminders are the workaround.
- **A save that fails offline is only retried by the next change.** Losing signal and then closing the tab loses what was logged since the last successful save.
- **Changing kg/lb doesn't convert** past entries.
- **Activities can't be edited** (delete and re-log).
- **Video links weren't verified as still online.** YouTube blocks automated checks. Each is one line in `VIDEO_LIBRARY`.
- **Forecasts are straight lines** and get optimistic as gains slow.
- **Simplified body figure:** 14 muscle groups, and it doesn't show the movement itself.

## 10. Testing

- `npm test`: unit tests for Autopilot, equipment steps, rep-range stability, rest, import, muscle rules, video library, live workout, forecasts, schedule and check-ins, activities and highlights. They import the domain modules directly.
- `npm run test:server`: pytest for the backend: storage round-trip, daily backup, corrupt-file refusal, access gate, the `/api/ask` request checks and Gemini translation, and errors becoming 502 (no network).
- `npm run test:e2e`: Playwright on a Pixel 5-sized screen with a fixed clock (Sat 3 Oct 2026, 18:00), seeded storage, and a fake AI that records requests. Each test starts the Python server with its own seeded data file. Covers live workout (reorder, check-off, reload, finish), history edit, activities, check-in, video-tag resolution, the Today card and export.
