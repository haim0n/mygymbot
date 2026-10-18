import { Footprints, Mountain, Bike, Waves, PersonStanding, Activity } from "lucide-react";

// Shown under Goals, so users and developers can tell which build they run. Bump it with package.json's "version" on every release.
export const APP_VERSION = "0.12.1";

export const STORAGE_KEYS = {
  workouts: "gymbot:workouts",
  settings: "gymbot:settings",
  chat: "gymbot:chat",
  formChecks: "gymbot:form-checks",
  session: "gymbot:session",
  dailyNote: "gymbot:daily-note",
  muscleMap: "gymbot:muscle-map",
  exercisePhotos: "gymbot:exercise-photos", // { exercise name: photo id, or null when no photo fits }
  bodyweight: "gymbot:bodyweight", // [{ date, weight }], oldest first, one per day
  rest: "gymbot:rest", // the rest timer, so a reload keeps counting: { label, duration (s), startedAt and endsAt (ms), exerciseId?, setId? }
};

export const EXPERIENCE_LEVELS = ["Beginner", "Intermediate", "Advanced"];
export const TRAINING_FOCUSES = ["Strength", "Muscle growth", "Fat loss", "General fitness"];
export const SEXES = ["Female", "Male"];
export const HEIGHT_UNITS = { kg: "cm", lb: "in" }; // height follows the weight unit, like distances

export const DEFAULT_SETTINGS = {
  profile: { name: "", unit: "kg", bodyweight: "", experience: "Intermediate", daysPerWeek: 4, focus: "Strength", coachStyle: "Encouraging", notes: "", foodNotes: "", trainingDays: [], trainingTime: "", birthYear: "", sex: "", height: "", sessionMinutes: "" },
  goals: [],
  repRanges: {}, // per-exercise overrides, e.g. { "Bench Press": [5, 8] }
  routines: [], // saved workout plans, done in turn: [{ name: "A", exercises: ["Back Squat", ...] }]
  coachMemory: [], // what the athlete told the coach that still matters: [{ text, date }], newest last
};

// Autopilot: double progression. Hit the top of the rep range on every set, then add weight.
export const REP_RANGES = [[3, 5], [3, 6], [5, 8], [6, 10], [8, 12], [10, 15], [12, 20]];
export const RANGE_HISTORY_SESSIONS = 8; // recent sessions used to infer an exercise's rep range
export const BIG_LOWER_BODY_LIFTS = ["squat", "deadlift", "leg press", "hip thrust"];

// Smallest real jump in weight per equipment type. Dumbbell weights are per dumbbell.
// Targets land on multiples of the step, so they're weights that exist in a gym.
export const EQUIPMENT_STEPS = {
  barbell: { kg: 2.5, lb: 5 },
  bigBarbell: { kg: 5, lb: 10 }, // squats, deadlifts, hip thrusts
  dumbbell: { kg: 2, lb: 5 },
  kettlebell: { kg: 4, lb: 5 },
  machine: { kg: 5, lb: 10 }, // weight stacks
  cable: { kg: 5, lb: 10 },
  bodyweight: { kg: 2.5, lb: 5 }, // added weight on a belt or vest
};
export const DELOAD_FACTOR = 0.9;
// Recommended rest between sets: heavier, lower-rep work needs longer recovery.
export const REST_BY_REP_RANGE = [[6, 180], [10, 120], [15, 90], [Infinity, 60]]; // [range top up to N reps, seconds]
export const BIG_LIFT_EXTRA_REST = 60; // seconds, for squats, deadlifts and hip thrusts
export const MAX_DAYS_BEFORE_EASING_BACK = 21;
export const PLAN_LOOKBACK_DAYS = 56; // only plan lifts trained in the last 8 weeks
export const NEW_EXERCISE_TARGET = { sets: 3, reps: 8 }; // a workout plan's exercise without an Autopilot target starts here; you fill in the weight
// How a set felt, asked in the rest bar. Too easy or too hard moves the exercise's next sets one weight step (2 reps without weight).
export const SET_FEELS = [
  { id: "easy", label: "Too easy", change: 1 },
  { id: "right", label: "Just right", change: 0 },
  { id: "hard", label: "Too hard", change: -1 },
];
// Lifts loaded with plates on a 20 kg (45 lb) bar, for the plates per side in the rest bar. Sleds and machines aren't.
export const PLATE_LIFTS = /barbell|bench press|squat|deadlift|overhead press|military press|push press|bent over row|pendlay row|clean|snatch|hip thrust/;
export const NOT_PLATE_LIFTS = /dumbbell|kettlebell|machine|smith|cable|hack|goblet|leg press|pistol|split squat|bodyweight/;
export const LEFT_OPEN_HOURS = 6; // a workout going longer than this was left open (one past midnight is not)
export const SET_FEEL_SCROLL_DELAY_MS = 300; // the set feel row is checked for being in sight once it has grown open (.gb-reveal)
export const EXERCISE_SEARCH_LIMIT = 50; // rows the exercise picker shows; typing or a muscle finds the rest
// Gym shorthand the exercise search understands, as a whole typed word ("db row" finds Dumbbell Row).
export const EXERCISE_ALIASES = {
  db: "dumbbell", bb: "barbell", kb: "kettlebell", bw: "bodyweight",
  rdl: "romanian deadlift", sldl: "stiff leg deadlift", dl: "deadlift", ohp: "overhead press", bp: "bench press",
  bss: "bulgarian split squat", hspu: "handstand push up", ghr: "glute ham raise",
};

// Import: header names used by Strong, Hevy and similar apps (matched case-insensitively).
export const COLUMN_ALIASES = {
  date: ["date", "start_time", "start time", "workout date", "day"],
  exercise: ["exercise name", "exercise_title", "exercise", "exercise title"],
  weight: ["weight", "weight_kg", "weight (kg)", "weight (kgs)", "weight_lbs", "weight (lbs)", "weight (lb)"],
  reps: ["reps", "repetitions"],
  weightUnit: ["weight unit", "unit"],
  setType: ["set_type", "set type"],
};
export const MAX_IMPORT_SCREENSHOTS = 6;
// Long scrolling screenshots are cut into overlapping slices so small text stays legible.
export const SCREENSHOT_TILE = { width: 900, height: 1300, overlap: 80, maxPerScreenshot: 8 }; // px, ~1.15 MP per slice

export const PLAN_STATUS = {
  increase: { label: "Add weight", className: "bg-green-50 text-green-700" },
  reps: { label: "Add reps", className: "bg-blue-50 text-blue-700" },
  repeat: { label: "Repeat", className: "bg-zinc-100 text-zinc-600" },
  deload: { label: "Deload", className: "bg-amber-50 text-amber-700" },
  hold: { label: "Hold for pain", className: "bg-rose-50 text-rose-700" },
};

// Shown where injuries are entered and at the bottom of Goals; the final wording waits for the legal review (#21).
export const MEDICAL_NOTICE = "MyGymBot gives training suggestions, not medical advice. See a doctor or physiotherapist about pain or injuries.";
export const SAVE_RETRY_MS = { first: 1000, max: 10000 }; // a failed save is retried after 1 s, doubling up to 10 s
export const CHAT_CONTEXT_SIZE = 12; // messages sent to the coach per request
export const CHAT_HISTORY_SIZE = 60; // messages kept on device
export const BODYWEIGHT_CONTEXT_ENTRIES = 30; // latest bodyweight entries the coach sees
export const FRAME_COUNT = 6; // frames sampled from a form-check video
export const FRAME_MAX_SIDE = 768; // px, keeps image uploads small

// Muscles
export const MUSCLES = ["chest", "shoulders", "biceps", "triceps", "forearms", "core", "traps", "lats", "upperBack", "lowerBack", "glutes", "quads", "hamstrings", "calves"];
export const MUSCLE_LABELS = {
  chest: "Chest", shoulders: "Shoulders", biceps: "Biceps", triceps: "Triceps", forearms: "Forearms", core: "Core", traps: "Traps",
  lats: "Lats", upperBack: "Upper back", lowerBack: "Lower back", glutes: "Glutes", quads: "Quads", hamstrings: "Hamstrings", calves: "Calves",
};
export const MUSCLE_COLORS = { primary: "#dc2626", secondary: "#fca5a5", idle: "#e4e4e7", body: "#d4d4d8" };
// Weekly heatmap shades, heaviest first (sets in the last 7 days).
export const VOLUME_LEVELS = [
  { min: 10, color: "#1d4ed8", label: "10+ sets" },
  { min: 5, color: "#60a5fa", label: "5–9 sets" },
  { min: 0.5, color: "#bfdbfe", label: "Under 5 sets" },
];
export const MAX_EXERCISES_PER_CLASSIFICATION = 20; // keeps the coach's JSON answer well inside its length limit
export const INJURY_READ_DELAY_MS = 2000; // wait until typing in "Injuries and equipment" pauses before asking which muscles it affects

// Exercise name → muscles, checked in order, so specific patterns come first. Unmatched names are classified by the coach.
export const MUSCLE_RULES = [
  { match: /romanian|stiff[- ]?leg|\brdl\b|good ?morning/, primary: ["hamstrings", "glutes"], secondary: ["lowerBack"] },
  { match: /deadlift/, primary: ["glutes", "hamstrings"], secondary: ["lowerBack", "traps", "forearms"] },
  { match: /hip thrust|glute bridge/, primary: ["glutes"], secondary: ["hamstrings"] },
  { match: /leg curl|hamstring curl|nordic/, primary: ["hamstrings"], secondary: [] },
  { match: /leg extension/, primary: ["quads"], secondary: [] },
  { match: /back extension|hyperextension|superman/, primary: ["lowerBack"], secondary: ["glutes", "hamstrings"] },
  { match: /squat|leg press|lunge|step[- ]?up|hack/, primary: ["quads", "glutes"], secondary: ["hamstrings", "core"] },
  { match: /calf|calves/, primary: ["calves"], secondary: [] },
  { match: /close[- ]grip bench|skull ?crusher|tricep|pushdown|kickback|overhead extension|french press/, primary: ["triceps"], secondary: [] },
  { match: /\bdips?\b/, primary: ["triceps", "chest"], secondary: ["shoulders"] },
  { match: /face pull|rear delt|reverse (fly|flye|pec)/, primary: ["shoulders", "upperBack"], secondary: ["traps"] },
  { match: /bench|chest press|push[- ]?up/, primary: ["chest"], secondary: ["triceps", "shoulders"] },
  { match: /\bfly|flye|pec deck|crossover/, primary: ["chest"], secondary: ["shoulders"] },
  { match: /upright row/, primary: ["shoulders", "traps"], secondary: ["biceps"] },
  { match: /lateral raise|front raise/, primary: ["shoulders"], secondary: ["traps"] },
  { match: /overhead press|shoulder press|military|arnold|push press/, primary: ["shoulders"], secondary: ["triceps", "traps"] },
  { match: /shrug/, primary: ["traps"], secondary: ["forearms"] },
  { match: /pull[- ]?up|chin[- ]?up|pulldown|pullover/, primary: ["lats"], secondary: ["biceps", "upperBack"] },
  { match: /\brow\b/, primary: ["upperBack", "lats"], secondary: ["biceps", "shoulders"] },
  { match: /hammer curl|reverse curl|wrist curl|farmer/, primary: ["forearms", "biceps"], secondary: [] },
  { match: /curl/, primary: ["biceps"], secondary: ["forearms"] },
  { match: /plank|crunch|sit[- ]?up|\babs?\b|leg raise|russian twist|wood ?chop|pallof|rollout/, primary: ["core"], secondary: [] },
  { match: /swing/, primary: ["glutes", "hamstrings"], secondary: ["core", "shoulders"] },
  { match: /clean|snatch/, primary: ["quads", "glutes"], secondary: ["traps", "shoulders", "hamstrings"] },
];

// Video guides: a fixed, hand-picked library from established coaches. The coach can only point to these,
// so nothing is searched on the web and no link is ever invented. To add a video, add a line.
// Matched against exercise names in order, so specific patterns come first.
export const VIDEO_MARKER = /^\s*\[video:\s*(.+?)\]\s*$/i; // the coach writes [video: Exercise Name] on its own line
export const ROUTINE_MARKER = /^\s*\[plan:\s*([^:\]]+?)\s*:\s*(.+?)\]\s*$/i; // the coach writes [plan: Name: Exercise, Exercise, ...] on its own line
export const IMPORT_MARKER = /^\s*\[import\]\s*$/i; // the coach writes [import] on its own line for a button that opens Import history
export const MEMORY_MARKER = /^\s*\[remember:\s*(.+?)\]\s*$/i; // the coach writes [remember: fact] or [remember: fact | replaces: old fact] on its own line
export const PROFILE_MARKER = /^\s*\[profile:\s*(.+?)\]\s*$/i; // a new athlete's interview ends with [profile: field: value; field: value; ...]
export const VIDEO_LIBRARY = [
  { exercise: "Incline press", match: /incline.*(press|bench)/, videos: [{ id: "SrqOu55lrYU", channel: "Jeff Nippard" }] },
  { exercise: "Dumbbell bench press", match: /bench.*dumbbell|dumbbell.*bench/, videos: [{ id: "WLTU1j7Ur8M", channel: "BarBend" }] },
  { exercise: "Bench press", match: /bench/, videos: [{ id: "vcBig73ojpE", channel: "Alan Thrall" }] },
  { exercise: "Push-up", match: /push[- ]?up/, videos: [{ id: "IODxDxX7oi4", channel: "FitnessFAQs" }] },
  { exercise: "Cable crossover", match: /crossover/, videos: [{ id: "Iwe6AmxVf7o", channel: "Athlean-X" }] },
  { exercise: "Chest fly", match: /^(?!.*reverse).*(\bfly|flye|pec deck)/, videos: [{ id: "eozdVDA78K0", channel: "Jeremy Ethier" }] },
  { exercise: "Dumbbell pullover", match: /pullover/, videos: [{ id: "JUz6njqPyuA", channel: "Renaissance Periodization" }] },
  { exercise: "Pull-up", match: /pull[- ]?up|chin[- ]?up/, videos: [{ id: "eGo4IYlbE5g", channel: "Calisthenicmovement" }] },
  {
    exercise: "Lat pulldown",
    match: /pulldown/,
    videos: [
      { id: "3PmWIGn0dwU", channel: "Renaissance Periodization" },
      { id: "CAwf7n6Luuc", channel: "John Meadows" },
    ],
  },
  { exercise: "T-bar row", match: /t[- ]?bar/, videos: [{ id: "j3Igk5nyZE4", channel: "Buff Dudes" }] },
  { exercise: "Seated cable row", match: /seated.*row|cable row|machine row/, videos: [{ id: "GZbfZ033f74", channel: "Jeff Nippard" }] },
  { exercise: "Barbell row", match: /^(?!.*upright).*\brow\b/, videos: [{ id: "T3N-TO4reLQ", channel: "Alan Thrall" }] },
  { exercise: "Romanian deadlift", match: /romanian|stiff[- ]?leg|\brdl\b/, videos: [{ id: "JCXUYuzwNrM", channel: "Alan Thrall" }] },
  { exercise: "Good morning", match: /good ?morning/, videos: [{ id: "YA-h3n9L4YU", channel: "Mark Bell" }] },
  { exercise: "Deadlift", match: /deadlift/, videos: [{ id: "wYREQkVtvEc", channel: "Mark Rippetoe" }] },
  { exercise: "Bulgarian split squat", match: /split squat/, videos: [{ id: "2C-uNgKwPLE", channel: "Jeremy Ethier" }] },
  { exercise: "Barbell back squat", match: /^squat$|back squat|barbell squat/, videos: [{ id: "bEv6CCg2BC8", channel: "Jeff Nippard" }] },
  { exercise: "Leg press", match: /leg press/, videos: [{ id: "IZxyjW7MPJQ", channel: "John Meadows" }] },
  { exercise: "Leg extension", match: /leg extension/, videos: [{ id: "YyvSfVjQeL0", channel: "Jeremy Ethier" }] },
  { exercise: "Hamstring curl", match: /leg curl|hamstring curl/, videos: [{ id: "1Tq3QdYUuHs", channel: "Jeff Nippard" }] },
  { exercise: "Hip thrust", match: /hip thrust/, videos: [{ id: "xDmFkJxPZqQ", channel: "Bret Contreras" }] },
  { exercise: "Glute bridge", match: /glute bridge/, videos: [{ id: "GkV0prJZ5D8", channel: "Athlean-X" }] },
  { exercise: "Seated calf raise", match: /seated calf/, videos: [{ id: "JbyjNymZOt0", channel: "ScottHermanFitness" }] },
  { exercise: "Standing calf raise", match: /calf/, videos: [{ id: "wxwY7GXxL4k", channel: "Athlean-X" }] },
  { exercise: "Shoulder press", match: /overhead press|shoulder press|military/, videos: [{ id: "qEwKCR5JCog", channel: "ScottHermanFitness" }] },
  { exercise: "Lateral raise", match: /lateral raise/, videos: [{ id: "3VcKaXpzqRo", channel: "ScottHermanFitness" }] },
  { exercise: "Face pull", match: /face pull/, videos: [{ id: "eIq5CB9JfKE", channel: "Athlean-X" }] },
  { exercise: "Incline dumbbell curl", match: /incline.*curl/, videos: [{ id: "soxrZlIl35U", channel: "ScottHermanFitness" }] },
  { exercise: "Hammer curl", match: /hammer curl/, videos: [{ id: "zC3nLlEvin4", channel: "ScottHermanFitness" }] },
  { exercise: "Reverse curl", match: /reverse curl/, videos: [{ id: "nRgxYX2Ve9w", channel: "Howcast" }] },
  { exercise: "Wrist curl", match: /wrist curl/, videos: [{ id: "3VLTzIrnb5g", channel: "PureGym" }] },
  { exercise: "Barbell curl", match: /(barbell|ez[- ]?bar|bicep|biceps) curl/, videos: [{ id: "kwG2ipFRgfo", channel: "Howcast" }] },
  { exercise: "Triceps pushdown", match: /pushdown/, videos: [{ id: "2-LAMcpzODU", channel: "ScottHermanFitness" }] },
  { exercise: "Skull crusher", match: /skull ?crusher|lying tricep/, videos: [{ id: "d_KZxkY_0cM", channel: "ScottHermanFitness" }] },
  { exercise: "Dips", match: /\bdips?\b/, videos: [{ id: "6kALZikXxLc", channel: "Howcast" }] },
  { exercise: "Farmer's walk", match: /farmer/, videos: [{ id: "Fkzk_RqlYig", channel: "Buff Dudes" }] },
];

// Motivation
export const COACH_STYLES = {
  Encouraging: "warm and supportive",
  Hype: "high-energy and fired up, with short punchy sentences",
  Calm: "calm, steady and matter-of-fact",
  "Tough love": "blunt and demanding, but never insulting",
};
export const MILESTONES = [10, 25, 50, 75, 100, 150, 200, 300, 400, 500]; // sessions logged
export const RECENT_RECORD_DAYS = 7;
export const GOAL_CLOSE_RATIO = 0.9; // within 10% of a goal
export const GOAL_DUE_SOON_DAYS = 14;
export const MAX_TODAY_FACTS = 4;
export const MAX_COACH_FACTS = 20; // the coach's memory keeps the newest; a short list keeps every prompt small
export const REST_NOTE_CHAT_MESSAGES = 6; // the latest coach chat messages a rest note sees, so it follows up on what was said
// The rest-screen notes of one workout take these in turn, so the coach doesn't open every note the same way.
export const REST_NOTE_KINDS = [
  "a cue for the next set",
  "a quick question about how that set felt",
  "a word on the set just done that cites its numbers",
  "a short, interesting fact about this exercise or the muscle it trains",
];
// Something to read between sets that isn't training, picked in Goals ("Between sets"). One AI call per workout writes
// REST_FUN_ITEMS of them; `ask` is what that call asks for, `reveal` the button that shows the answer (none for facts).
export const REST_FUN_ITEMS = 15;
export const REST_FUN_KINDS = {
  Trivia: {
    ask: (topic) => `trivia questions ${topic ? `about ${topic}` : "on varied subjects"}; text is the question, reveal its short answer`,
    reveal: "Tap for the answer",
    topicLabel: "Topic",
    placeholder: "Any topic",
  },
  "Learn a word": {
    ask: (topic) =>
      `everyday words or short phrases in ${topic || "Spanish"}, from easy to harder; text is the word (with how to say it in Latin letters when the script isn't Latin), reveal its meaning in English`,
    reveal: "Tap for the meaning",
    topicLabel: "Language",
    placeholder: "Spanish",
  },
  "Fact or quote": {
    ask: (topic) => `surprising facts or short quotes ${topic ? `about ${topic}` : "on varied subjects"}, a quote with the person's name in the text; reveal is null`,
    reveal: null,
    topicLabel: "Topic",
    placeholder: "Any topic",
  },
};

// Non-gym activities. Distance units follow the profile's units (kg → metric, lb → imperial).
export const ACTIVITY_TYPES = [
  { type: "Running", noun: "run", icon: Footprints, distance: { kg: "km", lb: "mi" }, pace: "perUnit" },
  { type: "Walking", noun: "walk", icon: Footprints, distance: { kg: "km", lb: "mi" }, pace: "perUnit" },
  { type: "Hiking", noun: "hike", icon: Mountain, distance: { kg: "km", lb: "mi" }, pace: "perUnit" },
  { type: "Cycling", noun: "ride", icon: Bike, distance: { kg: "km", lb: "mi" }, pace: "speed" },
  { type: "Swimming", noun: "swim", icon: Waves, distance: { kg: "m", lb: "yd" }, pace: "per100" },
  { type: "Rowing", noun: "row", icon: Waves, distance: { kg: "m", lb: "m" }, pace: "per500" },
  { type: "Yoga", icon: PersonStanding, distance: null },
  { type: "Pilates", icon: PersonStanding, distance: null },
  { type: "Other", icon: Activity, distance: null },
];
export const ACTIVITY_EFFORTS = ["Easy", "Moderate", "Hard"];

// Schedule, check-ins and forecasts
export const WEEKDAYS = [
  { day: 1, label: "Mon" }, { day: 2, label: "Tue" }, { day: 3, label: "Wed" }, { day: 4, label: "Thu" },
  { day: 5, label: "Fri" }, { day: 6, label: "Sat" }, { day: 0, label: "Sun" },
]; // Date.getDay() numbers, Monday first
export const LATE_AFTER_HOURS = 2;
export const CHECK_IN_WINDOW_DAYS = 2;
export const EFFORT_OPTIONS = ["Easy", "Just right", "Hard", "Too much"];
export const PAIN_OPTIONS = ["No", "A little", "Yes"];
export const PAIN_LOOKBACK_DAYS = 14; // pain reported in check-ins this recent is put in front of the coach
export const FORECAST_LOOKBACK_DAYS = 84;
export const FORECAST_MIN_SESSIONS = 3;
export const FORECAST_MIN_SPAN_DAYS = 14;
export const FORECAST_MIN_WEEKLY_GAIN = 0.1; // below this, progress counts as flat
export const FORECAST_MAX_DAYS = 365;

export const QUICK_PROMPTS = ["What should I eat today?", "Analyze my last 4 weeks", "Am I on track for my goals?", "Plan my next session", "Suggest workout plans", "Where am I stalling?"];

// Competition plate colours, heaviest first.
export const PLATES = {
  kg: {
    bar: 20,
    plates: [
      { weight: 25, color: "#dc2626" },
      { weight: 20, color: "#1d4ed8" },
      { weight: 15, color: "#facc15" },
      { weight: 10, color: "#16a34a" },
      { weight: 5, color: "#fafafa" },
      { weight: 2.5, color: "#dc2626" },
      { weight: 1.25, color: "#a1a1aa" },
    ],
  },
  lb: {
    bar: 45,
    plates: [
      { weight: 45, color: "#1d4ed8" },
      { weight: 35, color: "#facc15" },
      { weight: 25, color: "#16a34a" },
      { weight: 10, color: "#fafafa" },
      { weight: 5, color: "#dc2626" },
      { weight: 2.5, color: "#a1a1aa" },
    ],
  },
};

export const CHART = {
  accent: "#1d4ed8",
  grid: "#e4e4e7",
  tick: { fill: "#71717a", fontSize: 12 },
  tooltip: { borderRadius: 8, border: "1px solid #e4e4e7", fontSize: 13 },
};

export const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700;800&display=swap');
.gb-root { font-family: 'Barlow', system-ui, sans-serif; color-scheme: light; }
.gb-display { font-family: 'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif; letter-spacing: -0.01em; }
.gb-root :focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }
/* Fields show focus as one blue border, not a border plus a ring around it. */
.gb-root :is(input:not([type=checkbox], [type=radio]), textarea, select):focus-visible { outline: none; border-color: #1d4ed8; box-shadow: 0 0 0 1px #1d4ed8; }
/* Feel like an app, not a web page: no grey flash on tap, no text selection on a long press of a button. */
.gb-root { -webkit-tap-highlight-color: transparent; }
.gb-root button { -webkit-user-select: none; user-select: none; }
.gb-root button:active:not(:disabled) { opacity: 0.6; }
.gb-root textarea { resize: none; } /* a resize handle is a web page leftover */
/* A small text button gets a 40 px tall tap area without taking more room: the area reaches past it, invisibly. */
.gb-tap { position: relative; }
.gb-tap::after { content: ""; position: absolute; inset: -10px -8px; }
/* The finish screen's burst: dots and confetti fly out from the middle, spin and fade. Without motion they stay hidden. */
.gb-burst span { position: absolute; left: 50%; top: 50%; width: var(--size); height: var(--size); opacity: 0; animation: gb-burst 1500ms cubic-bezier(0.15, 0.75, 0.3, 1) both; }
@keyframes gb-burst {
  0% { opacity: 1; transform: translate(-50%, -50%) scale(0.3) rotate(0); }
  15% { opacity: 1; transform: translate(-50%, -50%) scale(1.1) rotate(0); }
  100% { opacity: 0; transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y))) scale(0.5) rotate(var(--spin)); }
}
/* Motion uses only transform and opacity (and grid rows for a height), so it stays smooth on a phone. Each way out has its own
   keyframes: swapping a class to the same keyframes reversed doesn't restart the animation, it jumps to the end. */
.gb-pop { animation: gb-pop 550ms cubic-bezier(0.3, 1.5, 0.5, 1) both; }
@keyframes gb-pop { from { opacity: 0; transform: scale(0.6); } }
.gb-rise { animation: gb-rise 450ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
@keyframes gb-rise { from { opacity: 0; transform: translateY(12px); } }
.gb-fade { animation: gb-fade 250ms ease-out both; }
@keyframes gb-fade { from { opacity: 0; } }
.gb-fade-out { animation: gb-fade-out 220ms ease-in both; }
@keyframes gb-fade-out { to { opacity: 0; } }
/* Bottom sheets slide up from the bottom and back down; the rest bar drops in from the top and back up. */
.gb-sheet-in { animation: gb-sheet-in 320ms cubic-bezier(0.32, 0.72, 0, 1) both; }
@keyframes gb-sheet-in { from { transform: translateY(100%); } }
.gb-sheet-out { animation: gb-sheet-out 220ms cubic-bezier(0.4, 0, 1, 1) both; }
@keyframes gb-sheet-out { to { transform: translateY(100%); } }
.gb-drop-in { animation: gb-drop-in 280ms cubic-bezier(0.32, 0.72, 0, 1) both; }
@keyframes gb-drop-in { from { transform: translateY(-100%); } }
.gb-drop-out { animation: gb-drop-out 220ms cubic-bezier(0.4, 0, 1, 1) both; }
@keyframes gb-drop-out { to { transform: translateY(-100%); } }
.gb-ease-padding { transition: padding-top 220ms cubic-bezier(0.4, 0, 1, 1); } /* the page moving up with the bar as it goes, near the top */
/* A row that grows open and shrinks closed, so the rows below slide instead of jumping. */
.gb-reveal { display: grid; grid-template-rows: 1fr; animation: gb-reveal 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
@keyframes gb-reveal { from { grid-template-rows: 0fr; opacity: 0; } }
.gb-reveal.gb-reveal-out { grid-template-rows: 0fr; opacity: 0; visibility: hidden; animation: gb-reveal-out 220ms cubic-bezier(0.4, 0, 1, 1) both; }
@keyframes gb-reveal-out { from { grid-template-rows: 1fr; opacity: 1; visibility: visible; } 45% { opacity: 0; } } /* faded before it is cut */
.gb-reveal > * { min-height: 0; overflow: clip; overflow-clip-margin: 4px; }
@media (prefers-reduced-motion: reduce) { .gb-root * { animation: none !important; scroll-behavior: auto !important; } }
`;
