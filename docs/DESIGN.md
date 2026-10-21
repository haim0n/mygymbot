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
  exercises: { name: string; sets: { weight: number; reps: number; feel?: "easy" | "right" | "hard" }[] }[]; // gym lifts, in the order done; feel from the row under the set
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
  restFun?: { kind: "Off" | "Trivia" | "Learn a word" | "Fact or quote"; topic: string; seen?: string[] }; // something to read between sets; seen: the last REST_FUN_SEEN shown, so they don't come back
};

type Session = { // the workout in progress
  date: string; startedAt: number | null; notes: string; routine?: string;
  coachNotes?: { exercise: string; text: string; restStartedAt: number }[]; coachQuiet?: boolean; // the coach's rest notes, and Quiet
  restReading?: { items: { text: string; reveal: string | null }[]; index: number; restStartedAt: number | null }; // what to read between sets: the item showing and the rest it shows in (an older `restFun` array is ignored)
  exercises: { id: string; name: string; rest: number /* s */; sets: { id: string; weight: number | string; reps: number | string; done: boolean; feel?: string }[] }[];
}; // weights/reps may be strings while typed; sessionToWorkout() turns them into numbers
```

Storage keys (all personal scope):

| Key | Contents |
|---|---|
| `gymbot:workouts` | `Workout[]` |
| `gymbot:settings` | `Settings` |
| `gymbot:session` | `Session \| null` |
| `gymbot:rest` | the rest timer: `{ label, duration, startedAt, endsAt, exerciseId?, setId? }`, so a reload keeps counting |
| `gymbot:chat` | last 60 coach messages `{ role, content }` |
| `gymbot:form-checks` | last 30 `{ id, date, exercise, feedback }` |
| `gymbot:food` | meals, oldest first: `{ id, date, time, name, items: [{ name, grams, per100: { protein, carbs, fat, kcal } }] }` (no photos) |
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

App-level state: workouts, settings, chat, form checks, food, session, rest timer, open details sheet, and the derived values (`records`, `plans`, `coachContext`, Today facts, daily note, learned muscles and photos). `ExerciseContext` gives every thumbnail the learned muscles and photos, the details-sheet opener and what the form check in the sheet needs, without passing them down.

## 5. Features and the rules behind them

### Autopilot (double progression), `buildAutopilotPlans`
- **Working sets** are the sets at the session's top weight; lighter warm-up and back-off sets are ignored.
- **Rep range**: the user's override, otherwise inferred. Take the median working-set reps over the last 8 sessions and pick the preset (3–5, 3–6, 5–8, 6–10, 8–12, 10–15, 12–20) whose midpoint is closest. This stays stable while the user follows the targets, because a full cycle from the bottom to the top of a range has that range's midpoint as its median (tested over 15 sessions).
- **Rules**, in order:
  - More than 21 days since last time: **deload** (×0.9).
  - Every set hit the top of the range: **add weight**, reps back to the bottom. Unless a set at that weight was rated too hard: **hold** the weight.
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
- **Sets:** editable weight and reps; ✓ marks a set done and starts rest automatically (except after the final set). The rest timer is stored (`gymbot:rest`, an end time), so a reload keeps counting; a rest that ended while the app was closed is not shown.
- **Set feel (`rateSet`, `SET_FEELS`, `SetFeel`):** while you rest after a set, a row opens under that set (where your thumb just was) and asks Too easy, Just right or Too hard, one tap, once per set; the answer stays there until the rest ends. Too easy or too hard moves the exercise's sets still to do at that weight one weight step, onto a weight that exists (2 reps without weight), so the next set fits how this one went. The feel is kept on the set (`feel`, optional), the coach sees it on the finish screen, and Autopilot holds the weight instead of adding to it when a top-weight set was too hard. No AI call.
- **Next set (`nextSet`):** the rest bar shows the set after the rest (this exercise's next, else the first left in the workout), with the plates per side for lifts on a barbell (`PLATE_LIFTS`; not sleds or machines). A rest after a set ends with its workout. A rest kept across a reload chimes too, after the first tap anywhere (browsers allow sound only after a tap).
- **Finishing an exercise** scrolls to the one you're on next (the first with sets left), also when you trained out of order and it is further up.
- **Reordering** happens in a compact list, so a moved exercise doesn't jump out from under the finger.
- **Saving:** the session is persisted (survives tab switches and reloads), and opening the app mid-workout opens Log. Finish saves only checked sets.
- **Finish screen (`WorkoutDone`):** full screen, "Workout done" with a burst of dots and confetti (none with reduced motion) and a vibration: minutes (at least 1; none for a workout left open, i.e. going for more than `LEFT_OPEN_HOURS`; `workoutMinutes`), sets and volume counting up, the highlights (bests, weight increases, the week's progress), and one line from the coach (`WORKOUT_DONE_PROMPT`, one AI call), then a weigh-in (`WeighIn`: today's bodyweight into `gymbot:bodyweight`, the history chart in Progress; once logged that day it only shows the weight). Done (or Android's Back) closes it; Continue this workout takes the saved workout back and reopens it, for a finish tapped by mistake.
- **Coach between sets (`useRestNote`):** the first rest of each exercise gets one short line from the coach in the rest bar (`REST_NOTE_PROMPT`, under 20 words, nothing else: no sound, no extra rests). The kind rotates (`REST_NOTE_KINDS`: a cue, a question, the set's numbers, a fact), and the coach sees the coach context, the latest 6 chat messages and what it already said, so it follows up on the chat. Reply puts the note in the coach chat and opens it; Quiet stops the notes for that workout. While a workout is in progress the chat answers in 1 to 3 lines.
- **Something to read between sets (`useRestFun`):** a break from training, if picked in Goals → Between sets: trivia, a word in a language you are learning, or a fact or quote, each on a topic you may name. An AI call writes a batch of `REST_FUN_ITEMS` (20) into the session at the start of a workout, so the first rest has one, and another batch when `REST_FUN_REFILL_AT` or fewer are left unread (`REST_FUN_PROMPT`, JSON, checked by `parseRestFun`). Each batch is sent the last `REST_FUN_SEEN` items already shown (`settings.restFun.seen`, `rememberSeen`), so later workouts don't repeat them. Each rest starts on the next unread item, and Next (Next question, Next word, Another one) moves on within the rest (`nextReading`, `readingFor`), so a long rest has as many as you like. Swiping it sideways puts it away for this rest (`SWIPE_AWAY_PX`; a screen reader gets a Hide button); Off in Goals turns it off for good. An answer or meaning shows on a tap, or by itself when the rest is over. Rests with a coach's note don't show one, so the bar has one thing to read; after Quiet every rest has one. Off by default, so nobody gets the extra calls without asking for it.
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
The latest workout from the last 2 days gets a "How did it go?" card from the next day (right after a workout the finish screen has just shown it, and soreness or pain shows up a day later): effort, pain and an optional note. It stays until answered or skipped. The coach replies with something session-specific, a recovery tip and a meal idea, and pain gets rest plus "see a professional if it persists". Answers are stored on the workout and included in the coach context.

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
- **Finding an exercise (`searchExercises`, `ExercisePicker`):** one sheet adds an exercise to the workout or replaces one. It searches by name (each typed word, ignoring case and punctuation) and filters by main muscle. Your exercises come first (most done first, then the ones in saved plans and the workout in progress), then the 143 common names, then the 675 library names; the library shows only once you type or pick a muscle, as it is long and its names are clumsy. Replace starts on the old exercise's main muscle, so the alternatives show without typing. Gym shorthand works as a whole word (`EXERCISE_ALIASES`: db, bb, kb, rdl, ohp, sldl, bss, ...). One row per exercise: names that differ only in plural, word order or punctuation are one, and a library name whose photo a name above already shows is left out. When nothing matches, the name can be added as typed. A picked exercise starts at its Autopilot target, else at 3 x 8 with the weight to fill in; a replacement without a target keeps the sets still to do. Sets already done stay logged under the old name. Replace in a saved workout (History, Edit) changes only the name: the sets were right, the exercise was another one (`renameExercise`).
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

### Food (`food.js`, the Food tab)
Protein first: photo estimates run about 35% off and mostly too low (oil and sauces hide), so the AI's answer is a draft to correct, and protein is the number that matters for training.
- **Adding a meal:** Snap a meal opens the camera, Or choose a photo the phone's photos; or type it ("2 eggs, toast"); a typed note goes along with a photo. One AI call (`FOOD_PROMPT`, JSON, checked by `parseFoodDraft`) returns a name, the items with grams and their values per 100 g, and at most one question when one thing would change the numbers a lot ("Cooked in oil?"), whose options can add an item.
- **Correcting:** change grams, remove an item, or add one in words (one more AI call for just that). The totals come from grams and the values per 100 g (`itemTotals`, `mealTotals`), so an edit needs no AI. The photo isn't stored.
- **Protein target (`proteinTarget`):** 1.6 g per kg of the latest bodyweight a day, with 2.2 as the useful top (`PROTEIN_PER_KG`); without a bodyweight, no target.
- **Usual meals (`usualMeals`):** the same foods logged 3 times or more become one-tap buttons that log the latest version now, with no AI call.
- **Tab:** today's protein against the target (with kcal, carbs and fat small), Snap a meal and Type it, usual meals, today's meals (tap one to edit or delete it), and protein over the last 7 days against the target.
- **Coach:** sees today's protein against the target, the kcal and the average over the logged days of the week, marked as estimates and to be used only for food or recovery questions (`foodContext`; without that, a workout plan ended with a protein reminder), only when something was logged that week. Checked with the `food-asked` and `food-not-asked` scenarios in `scripts/coach_eval.mjs`.

### Form check
In each exercise's details sheet, folded until "Check my form" is tapped, with that exercise's past checks under it.
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
- what they ate today and this week (protein against the target), when they logged food
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
| `COACH_PROMPT` | Coach chat | Stays on training, food and recovery (anything else gets one line and an offer, also when told to ignore its rules); video-tag rules, food rules, coaching style |
| `ONBOARDING_PROMPT` | Coach chat, new athletes only | Interview, then profile and plan tags |
| `LOG_PARSER_PROMPT` | "Describe what you did" | Returns exercises + activities as JSON |
| `FORM_PROMPT` | Form check (exercise details sheet) | Frames or photos as images |
| `FOOD_PROMPT` | Food tab: a meal from a photo or words | JSON items with grams and values per 100 g, at most one question |
| `COLUMN_MAPPER_PROMPT` | Unknown CSV layouts | Only header + 5 rows leave the device |
| `SCREENSHOT_IMPORT_PROMPT` | Screenshot import | Tiles of one screenshot per request |
| `MUSCLE_CLASSIFIER_PROMPT` | Unknown exercises | Batches of 20, cached |
| `EXERCISE_PHOTO_PROMPT` | Exercises without a same-named photo | Batches of 20, cached, `null` when none fits |
| `REST_NOTE_PROMPT` | Rest bar during a workout | Once per exercise, kinds in turn, sees the latest chat |
| `REST_FUN_PROMPT` | Rest bar during a workout ("Between sets" in Goals) | Batches of 20, JSON, nothing about training, never what was already shown |
| `WORKOUT_DONE_PROMPT` | Finish screen | One line: something to be proud of, then recovery or the next session |
| `MOTIVATION_PROMPT` | Daily note | Once a day per style, cached |
| `CHECK_IN_PROMPT` | Post-workout check-in reply | Stored on the workout |

All JSON answers go through `askAIForJson`, which reads the outermost `{…}` so extra prose or code fences don't break parsing.

## 7. UI map

- **Coach:** like a messaging app, the title, the Today card and the input stay in place and only the chat scrolls. The chat opens at the latest message and follows new ones, unless the athlete scrolled back. The Today card is one line (its first fact) until tapped; tapping the input closes it again, to keep room for the keyboard · for a new athlete, the coach's first question instead of quick prompts · quick prompts (incl. "What should I eat today?") above the input.
- **Log:** Import history (toggle) · Workout done (full screen after Finish) · Session saved (after an activity) · check-in card · coach reply · Workout (Add exercise and Replace open the exercise picker; Save as a plan; a workout left open (going for more than `LEFT_OPEN_HOURS`, 6; one past midnight is not) asks whether to save it as the day it started or train it today) or Start a workout (saved plans, the next one first in line; for a new user, Start an empty workout is the main button) · Log an activity · Up next · Describe what you did · History (folded). During a workout, Log an activity and Describe what you did are hidden: the page is the workout.
- **Food:** today's protein against the target · Snap a meal, or type it · usual meals · the meal editor (grams, the AI's question, add in words) · today's meals · protein this week.
- **Progress:** stats · Activities (last 7 days) · muscle heatmap · estimated 1RM chart with trend line · weekly volume · best lifts.
- **Goals:** goal cards (barbell loaded with plates you've lifted, forecast) · new goal · About you (with the "not medical advice" notice under injuries; units, experience, sessions per week, minutes per session, birth year, sex, height, training days, usual time, food preferences, workout music, coaching style, between sets, main focus, injuries and equipment) · What your coach knows (facts from chats, edit or delete) · Your data (export as text) · Feedback (kept by the server in `feedback.jsonl`)
- **Everywhere:** rest timer bar (top, with the next set, the coach's note, Reply and Quiet), tab bar with a dot while a workout is in progress, exercise details sheet (with Check my form).
- **Motion:** smooth and short (about 0.2 to 0.3 s), only transform, opacity and grid rows, so it stays smooth on a phone; none with reduced motion. Sheets slide up and back down, the rest bar drops in and slides back up, the set feel row grows open and shrinks closed, and the finish screen fades in and out. When the rest bar comes, goes or grows, the page scrolls by as much, so the set you just ticked stays under your finger; near the top, where there is no room to scroll back, the page eases up with the bar. The finish screen's stats count up as their cards rise. Android's Back closes a sheet or the finish screen instead of leaving the app (`useBackToClose`: each has a history entry while open).

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
- **Unsaved changes live in memory.** A failed save is retried (newest value per key, 1 s doubling to 10 s) and "Not saved yet" shows meanwhile, but closing the app while offline loses what wasn't saved.
- **Changing kg/lb doesn't convert** past entries.
- **Food numbers are estimates**, about 35% off from a photo before the grams are corrected; only today and the last 7 days are shown.
- **Activities can't be edited** (delete and re-log).
- **Video links weren't verified as still online.** YouTube blocks automated checks. Each is one line in `VIDEO_LIBRARY`.
- **Forecasts are straight lines** and get optimistic as gains slow.
- **Simplified body figure:** 14 muscle groups, and it doesn't show the movement itself.

## 10. Testing

- `npm test`: unit tests for Autopilot, equipment steps, rep-range stability, rest, import, muscle rules, video library, live workout, set feel, exercise search (shorthand, one row per exercise) and replace, forecasts, schedule and check-ins, activities and highlights, what to read between sets, and food (totals, protein target, usual meals, the AI draft checked, the coach's food line). They import the domain modules directly.
- `npm run test:server`: pytest for the backend: storage round-trip, daily backup, corrupt-file refusal, access gate, the `/api/ask` request checks, daily AI limits (calls and tokens), the input cap, usage log line and Gemini translation, the request size limit, app error reports, and errors becoming 502 (no network).
- `npm run test:e2e`: Playwright on a Pixel 5-sized screen with a fixed clock (Sat 3 Oct 2026, 18:00), seeded storage, and a fake AI that records requests. Each test starts the Python server with its own seeded data file. Covers live workout (reorder, check-off, reload during a rest, finish, the finish screen with its weigh-in and continue after a finish by mistake, scroll back to an unfinished exercise, set feel, trivia between sets with Next), the exercise picker (search, add, replace, Android Back), history edit (with Replace), activities, check-in, video-tag resolution, the Today card, food (a typed meal with its question, corrected and saved, then deleted; a photo; a usual meal), form check in the details sheet, export, a failed save being retried, and an app error reported once, and feedback.
