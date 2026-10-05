import { useState, useEffect, useMemo, useRef, createContext, useContext } from "react";
import Papa from "papaparse";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { MessageCircle, Dumbbell, Video, TrendingUp, Target, Send, Trash2, Plus, Sparkles, Loader2, Upload, X, Check, Timer, PlayCircle, ChevronUp, ChevronDown, ArrowUpDown, Info, Footprints, Mountain, Bike, Waves, PersonStanding, Activity } from "lucide-react";

/* ───────────────────────────── Config ───────────────────────────── */

const MODEL = "claude-sonnet-4-6";

const STORAGE_KEYS = {
  workouts: "gymbot:workouts",
  settings: "gymbot:settings",
  chat: "gymbot:chat",
  formChecks: "gymbot:form-checks",
  session: "gymbot:session",
  dailyNote: "gymbot:daily-note",
  muscleMap: "gymbot:muscle-map",
};

const EXPERIENCE_LEVELS = ["Beginner", "Intermediate", "Advanced"];
const TRAINING_FOCUSES = ["Strength", "Muscle growth", "Fat loss", "General fitness"];

const DEFAULT_SETTINGS = {
  profile: { unit: "kg", bodyweight: "", experience: "Intermediate", daysPerWeek: 4, focus: "Strength", coachStyle: "Encouraging", notes: "", foodNotes: "", trainingDays: [], trainingTime: "" },
  goals: [],
  repRanges: {}, // per-exercise overrides, e.g. { "Bench Press": [5, 8] }
};

// Autopilot: double progression. Hit the top of the rep range on every set, then add weight.
const REP_RANGES = [[3, 5], [3, 6], [5, 8], [6, 10], [8, 12], [10, 15], [12, 20]];
const RANGE_HISTORY_SESSIONS = 8; // recent sessions used to infer an exercise's rep range
const BIG_LOWER_BODY_LIFTS = ["squat", "deadlift", "leg press", "hip thrust"];

// Smallest real jump in weight per equipment type. Dumbbell weights are per dumbbell.
// Targets land on multiples of the step, so they're weights that exist in a gym.
const EQUIPMENT_STEPS = {
  barbell: { kg: 2.5, lb: 5 },
  bigBarbell: { kg: 5, lb: 10 }, // squats, deadlifts, hip thrusts
  dumbbell: { kg: 2, lb: 5 },
  kettlebell: { kg: 4, lb: 5 },
  machine: { kg: 5, lb: 10 }, // weight stacks
  cable: { kg: 5, lb: 10 },
  bodyweight: { kg: 2.5, lb: 5 }, // added weight on a belt or vest
};
const DELOAD_FACTOR = 0.9;
// Recommended rest between sets: heavier, lower-rep work needs longer recovery.
const REST_BY_REP_RANGE = [[6, 180], [10, 120], [15, 90], [Infinity, 60]]; // [range top up to N reps, seconds]
const BIG_LIFT_EXTRA_REST = 60; // seconds, for squats, deadlifts and hip thrusts
const MAX_DAYS_BEFORE_EASING_BACK = 21;
const PLAN_LOOKBACK_DAYS = 56; // only plan lifts trained in the last 8 weeks

// Import: header names used by Strong, Hevy and similar apps (matched case-insensitively).
const COLUMN_ALIASES = {
  date: ["date", "start_time", "start time", "workout date", "day"],
  exercise: ["exercise name", "exercise_title", "exercise", "exercise title"],
  weight: ["weight", "weight_kg", "weight (kg)", "weight (kgs)", "weight_lbs", "weight (lbs)", "weight (lb)"],
  reps: ["reps", "repetitions"],
  weightUnit: ["weight unit", "unit"],
  setType: ["set_type", "set type"],
};
const MAX_IMPORT_SCREENSHOTS = 6;
// Long scrolling screenshots are cut into overlapping slices so small text stays legible.
const SCREENSHOT_TILE = { width: 900, height: 1300, overlap: 80, maxPerScreenshot: 8 }; // px, ~1.15 MP per slice

const PLAN_STATUS = {
  increase: { label: "Add weight", className: "bg-green-50 text-green-700" },
  reps: { label: "Add reps", className: "bg-blue-50 text-blue-700" },
  repeat: { label: "Repeat", className: "bg-zinc-100 text-zinc-600" },
  deload: { label: "Deload", className: "bg-amber-50 text-amber-700" },
};

const CHAT_CONTEXT_SIZE = 12; // messages sent to the coach per request
const CHAT_HISTORY_SIZE = 60; // messages kept on device
const FRAME_COUNT = 6; // frames sampled from a form-check video
const FRAME_MAX_SIDE = 768; // px, keeps image uploads small

// Muscles
const MUSCLES = ["chest", "shoulders", "biceps", "triceps", "forearms", "core", "traps", "lats", "upperBack", "lowerBack", "glutes", "quads", "hamstrings", "calves"];
const MUSCLE_LABELS = {
  chest: "Chest", shoulders: "Shoulders", biceps: "Biceps", triceps: "Triceps", forearms: "Forearms", core: "Core", traps: "Traps",
  lats: "Lats", upperBack: "Upper back", lowerBack: "Lower back", glutes: "Glutes", quads: "Quads", hamstrings: "Hamstrings", calves: "Calves",
};
const MUSCLE_COLORS = { primary: "#dc2626", secondary: "#fca5a5", idle: "#e4e4e7", body: "#d4d4d8" };
// Weekly heatmap shades, heaviest first (sets in the last 7 days).
const VOLUME_LEVELS = [
  { min: 10, color: "#1d4ed8", label: "10+ sets" },
  { min: 5, color: "#60a5fa", label: "5–9 sets" },
  { min: 0.5, color: "#bfdbfe", label: "Under 5 sets" },
];
const MAX_EXERCISES_PER_CLASSIFICATION = 20; // keeps the coach's JSON answer well inside its length limit

// Exercise name → muscles, checked in order, so specific patterns come first. Unmatched names are classified by the coach.
const MUSCLE_RULES = [
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
const VIDEO_MARKER = /^\s*\[video:\s*(.+?)\]\s*$/i; // the coach writes [video: Exercise Name] on its own line
const VIDEO_LIBRARY = [
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
const COACH_STYLES = {
  Encouraging: "warm and supportive",
  Hype: "high-energy and fired up, with short punchy sentences",
  Calm: "calm, steady and matter-of-fact",
  "Tough love": "blunt and demanding, but never insulting",
};
const MILESTONES = [10, 25, 50, 75, 100, 150, 200, 300, 400, 500]; // sessions logged
const RECENT_RECORD_DAYS = 7;
const GOAL_CLOSE_RATIO = 0.9; // within 10% of a goal
const GOAL_DUE_SOON_DAYS = 14;
const MAX_TODAY_FACTS = 4;

// Non-gym activities. Distance units follow the profile's units (kg → metric, lb → imperial).
const ACTIVITY_TYPES = [
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
const ACTIVITY_EFFORTS = ["Easy", "Moderate", "Hard"];

// Schedule, check-ins and forecasts
const WEEKDAYS = [
  { day: 1, label: "Mon" }, { day: 2, label: "Tue" }, { day: 3, label: "Wed" }, { day: 4, label: "Thu" },
  { day: 5, label: "Fri" }, { day: 6, label: "Sat" }, { day: 0, label: "Sun" },
]; // Date.getDay() numbers, Monday first
const LATE_AFTER_HOURS = 2;
const CHECK_IN_WINDOW_DAYS = 2;
const EFFORT_OPTIONS = ["Easy", "Just right", "Hard", "Too much"];
const PAIN_OPTIONS = ["No", "A little", "Yes"];
const FORECAST_LOOKBACK_DAYS = 84;
const FORECAST_MIN_SESSIONS = 3;
const FORECAST_MIN_SPAN_DAYS = 14;
const FORECAST_MIN_WEEKLY_GAIN = 0.1; // below this, progress counts as flat
const FORECAST_MAX_DAYS = 365;

const QUICK_PROMPTS = ["What should I eat today?", "Analyze my last 4 weeks", "Am I on track for my goals?", "Plan my next session", "Where am I stalling?"];

// Competition plate colours, heaviest first.
const PLATES = {
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

const CHART = {
  accent: "#1d4ed8",
  grid: "#e4e4e7",
  tick: { fill: "#71717a", fontSize: 12 },
  tooltip: { borderRadius: 8, border: "1px solid #e4e4e7", fontSize: 13 },
};

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700;800&display=swap');
.gb-root { font-family: 'Barlow', system-ui, sans-serif; color-scheme: light; }
.gb-display { font-family: 'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif; letter-spacing: -0.01em; }
.gb-root :focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .gb-root * { animation: none !important; scroll-behavior: auto !important; } }
`;

/* ───────────────────────────── Prompts ───────────────────────────── */

const COACH_PROMPT = `You are GymBot, a direct, knowledgeable strength coach.
Base every answer on the athlete's data below and cite specific dates, weights and reps.
Replies are read on a phone: keep them short, use "- " bullets and **bold** for key numbers.
If the data can't answer the question, say exactly what to log.
When planning a session, use the autopilot targets unless the athlete's notes give a reason to change them, and say why.
Match the coaching style given in the athlete profile.
The athlete may also run, swim, cycle or do yoga and Pilates. Count those in recovery, planning and food advice (for example, a hard run the day before heavy squats).
For food questions, suggest simple meals and snacks that fit the athlete's food preferences and today's training: carbs around training, protein spread over the day (about 1.6-2.2 g per kg of bodyweight suits strength and muscle goals). No crash diets or very low-calorie advice; for medical conditions, allergies or eating concerns, keep it general and suggest a registered dietitian.
When a technique video would genuinely help (learning a lift, fixing form), put [video: Exercise Name] on its own line, at most 2 per reply, choosing only exercises from the VIDEO LIBRARY below. The app shows the matching video. Never write URLs yourself.
You are not a medical professional: for pain or injury, recommend seeing one.
VIDEO LIBRARY: ${VIDEO_LIBRARY.map((guide) => guide.exercise).join(", ")}.`;

const LOG_PARSER_PROMPT = `Convert the workout description into JSON. Respond with JSON only, no prose or backticks.
Schema: {"exercises":[{"name":string,"sets":[{"reps":integer,"weight":number}]}],"activities":[{"type":string,"minutes":number,"distance":number|null,"distanceUnit":"km"|"mi"|"m"|"yd"|null,"effort":"Easy"|"Moderate"|"Hard"|null}]}
Rules: gym lifts go in exercises: use standard exercise names (e.g. "Bench Press", "Back Squat", "Romanian Deadlift"); expand "3x8 @ 60" into 3 sets of 8 at 60; use weight 0 for bodyweight; keep the user's numbers as given.
Cardio and mind-body sessions go in activities, with type one of: ${ACTIVITY_TYPES.map((t) => t.type).join(", ")}. "5k" means 5 km. Leave distance and effort null when not given.`;

const COLUMN_MAPPER_PROMPT = `You map the columns of a workout CSV export. Respond with JSON only, no prose or backticks:
{"date":column|null,"exercise":column|null,"weight":column|null,"reps":column|null,"weightUnit":column|null,"setType":column|null}
Use exact column names from the header row. weightUnit is a column holding "kg" or "lbs" per row; setType is a column that marks warm-up sets.`;

const SCREENSHOT_IMPORT_PROMPT = `Extract every strength workout visible in a fitness-app screenshot.
Respond with compact single-line JSON only, no prose or backticks.
Schema: {"workouts":[{"date":"YYYY-MM-DD","exercises":[{"name":string,"sets":[[weight,reps],...]}]}]}
Rules: list every set in order; write equipment in parentheses, e.g. "Bench Press (Dumbbell)"; skip warm-up sets and cardio; weight 0 for bodyweight; ignore estimated 1RM, volume and duration figures; if the year isn't shown, use the most recent past date.`;

const MUSCLE_CLASSIFIER_PROMPT = `Classify which muscles each exercise (one per line) trains. Respond with compact single-line JSON only, no prose or backticks:
{"<exercise name>":{"primary":[muscle,...],"secondary":[muscle,...]}}
Use only these muscle ids: chest, shoulders, biceps, triceps, forearms, core, traps, lats, upperBack, lowerBack, glutes, quads, hamstrings, calves.
1-2 primary muscles and up to 3 secondary. Use the exercise names exactly as given.`;

const MOTIVATION_PROMPT = `You are GymBot, the athlete's strength coach. Write today's motivation note: 1-2 sentences, under 40 words, plain text.
Build it on one specific fact from the data: a recent best, a streak, a lift going up next time, a goal getting close, or time since the last session.
No generic quotes, emojis or hashtags. Never guilt or shame; if they've been away, make coming back feel easy.
If a workout is planned today and not done yet, make the note a short pep talk for that session that names one specific target from the autopilot targets.`;

const CHECK_IN_PROMPT = `You are GymBot, the athlete's strength coach, checking in after a workout. Reply in 3-4 short sentences, plain text.
Acknowledge how it felt and mention one specific thing from the session. Give one recovery tip and one meal or snack idea that fits their food preferences.
If they report pain, tell them to rest that area and to see a professional if it's sharp or doesn't ease within a few days.
Match the coaching style given in the athlete profile. Never guilt or shame.`;

const FORM_PROMPT = `You are an expert strength coach reviewing exercise technique from images.
Answer in this structure:
**Verdict**: one line.
**What's good**: 1-3 bullets.
**Fix first**: the single most important correction, with a coaching cue.
**Also watch**: up to 2 bullets.
Add a **Safety** line only if something looks risky.
Be honest about what the images can't show (camera angle, motion between frames). Under 200 words.`;

/* ───────────────────────────── Persistence ───────────────────────────── */

function usePersistentState(key, initialValue) {
  const [value, setValue] = useState(initialValue);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await window.storage.get(key, false);
        if (stored?.value) setValue(JSON.parse(stored.value));
      } catch {
        // First run: nothing stored under this key yet.
      }
      setLoaded(true);
    })();
  }, [key]);

  // Debounced save so typing in a form doesn't hit storage on every keystroke.
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      window.storage.set(key, JSON.stringify(value), false).catch((err) => console.error(`Saving ${key} failed`, err));
    }, 300);
    return () => clearTimeout(timer);
  }, [key, value, loaded]);

  return [value, setValue, loaded];
}

/* ───────────────────────────── Claude client ───────────────────────────── */

async function callClaude({ system, messages, tools }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1000, system, messages, ...(tools && { tools }) }),
  });
  if (!response.ok) throw new Error(`The coach didn't respond (error ${response.status}). Try again.`);
  return (await response.json()).content ?? [];
}

const textOf = (blocks, separator) =>
  blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(separator)
    .trim();

async function askClaude(system, messages) {
  return textOf(await callClaude({ system, messages }), "\n");
}

// `content` is a string or an array of content blocks (text + images).
async function askClaudeForJson(system, content) {
  const raw = await askClaude(system, [{ role: "user", content }]);
  return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); // ignore any text around the JSON
}

// Last `count` messages, trimmed so the list starts with a user turn (API requirement).
function recentTurns(messages, count) {
  const turns = messages.slice(-count);
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

/* ───────────────────────────── Media ───────────────────────────── */

function toJpegBase64(source, width, height) {
  const scale = Math.min(1, FRAME_MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.75).split(",")[1];
}

function waitFor(element, eventName) {
  return new Promise((resolve, reject) => {
    element.addEventListener(eventName, resolve, { once: true });
    element.addEventListener("error", () => reject(new Error("This file format can't be read here.")), { once: true });
  });
}

// The artifact sandbox may block blob: URLs (that's what "The source image cannot be decoded" means),
// so images are decoded straight from the file and videos fall back to a data: URL.
const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });

// Claude reads images, not video, so we sample evenly spaced frames from the set.
async function sampleVideoFrames(src) {
  const video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, preload: "auto", src });
  await waitFor(video, "loadedmetadata");
  if (!Number.isFinite(video.duration)) throw new Error("Couldn't read the video length. Try a different recording.");
  const frames = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const seeked = waitFor(video, "seeked");
    video.currentTime = (video.duration * (i + 0.5)) / FRAME_COUNT;
    await seeked;
    frames.push(toJpegBase64(video, video.videoWidth, video.videoHeight));
  }
  return frames;
}

async function videoToFrames(file) {
  const blobUrl = URL.createObjectURL(file);
  try {
    return await sampleVideoFrames(blobUrl); // fast path
  } catch {
    return await sampleVideoFrames(await readAsDataUrl(file)); // works where blob: URLs are blocked
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function decodeImage(file) {
  try {
    return await createImageBitmap(file); // no URL involved, so sandbox rules don't apply
  } catch {
    const image = new Image(); // older browsers: go through a data: URL
    const loaded = waitFor(image, "load");
    image.src = await readAsDataUrl(file);
    await loaded;
    return image;
  }
}

async function withImage(file, draw) {
  const image = await decodeImage(file);
  try {
    return draw(image, { width: image.naturalWidth ?? image.width, height: image.naturalHeight ?? image.height });
  } finally {
    image.close?.(); // frees ImageBitmap memory
  }
}

const imageToFrame = (file) => withImage(file, (image, size) => toJpegBase64(image, size.width, size.height));

// Keeps the screenshot at a readable width and cuts it top to bottom into overlapping slices,
// instead of shrinking a tall scroll capture until the text is unreadable.
function screenshotToTiles(file) {
  return withImage(file, (image, size) => {
    const { width: maxWidth, height: tileHeight, overlap, maxPerScreenshot } = SCREENSHOT_TILE;
    const scale = Math.min(1, maxWidth / size.width);
    const width = Math.round(size.width * scale);
    const height = Math.round(size.height * scale);
    const tiles = [];
    for (let top = 0; tiles.length < maxPerScreenshot; top += tileHeight - overlap) {
      const sliceHeight = Math.min(tileHeight, height - top);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = sliceHeight;
      canvas.getContext("2d").drawImage(image, 0, top / scale, size.width, sliceHeight / scale, 0, 0, width, sliceHeight);
      tiles.push(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
      if (top + sliceHeight >= height) break;
    }
    return tiles;
  });
}

const imageBlock = (data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });

async function filesToMedia(files) {
  const video = files.find((file) => file.type.startsWith("video/"));
  if (video) return { kind: "video", frames: await videoToFrames(video) };
  const images = files.filter((file) => file.type.startsWith("image/")).slice(0, FRAME_COUNT);
  if (!images.length) throw new Error("Choose a video or photo file.");
  return { kind: "photos", frames: await Promise.all(images.map(imageToFrame)) };
}

/* ───────────────────────────── Dates & formatting ───────────────────────────── */

const toDateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDate = (key) => new Date(`${key}T00:00:00`);
const today = () => toDateKey(new Date());
const daysBetween = (fromKey, toKey) => Math.round((parseDate(toKey) - parseDate(fromKey)) / 86_400_000);
const formatDate = (key) => parseDate(key).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const formatShortDate = (key) => parseDate(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const formatLongDate = (key) => parseDate(key).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const pad2 = (n) => String(n).padStart(2, "0");
const formatClock = (seconds) => `${Math.floor(seconds / 60)}:${pad2(seconds % 60)}`;

function weekStart(dateKey) {
  const d = parseDate(dateKey);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  return toDateKey(d);
}

function formatVolume(n) {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/* ───────────────────────────── Training domain ───────────────────────────── */

const normalizeName = (name) => name.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
// "Bench Press (Barbell)" from other apps becomes "Bench Press"; other equipment stays in the name.
const cleanExerciseName = (name) => normalizeName(String(name ?? "").replace(/\s*\(barbell\)\s*$/i, ""));
const round1 = (n) => Math.round(n * 10) / 10;

// Epley formula.
const estimate1RM = ({ weight, reps }) => (reps <= 1 ? weight : weight * (1 + reps / 30));

const setsOf = (workout) => workout.exercises.flatMap((e) => e.sets);
const workoutVolume = (workout) => setsOf(workout).reduce((sum, s) => sum + s.weight * s.reps, 0);
const sortNewestFirst = (workouts) => [...workouts].sort((a, b) => b.date.localeCompare(a.date));
const sortOldestFirst = (workouts) => [...workouts].sort((a, b) => a.date.localeCompare(b.date));

function describeSets(sets, unit) {
  const load = (w) => (w ? `${w}` : "BW");
  const uniform = sets.every((s) => s.reps === sets[0].reps && s.weight === sets[0].weight);
  if (uniform) return `${sets.length}×${sets[0].reps} @ ${load(sets[0].weight)}${sets[0].weight ? ` ${unit}` : ""}`;
  return sets.map((s) => `${load(s.weight)}×${s.reps}`).join(", ");
}

function sanitizeExercises(raw) {
  return (raw?.exercises ?? [])
    .map((e) => ({
      name: cleanExerciseName(e.name),
      sets: (e.sets ?? [])
        .map((s) => ({ reps: Math.round(Number(s.reps) || 0), weight: Number(s.weight) || 0 }))
        .filter((s) => s.reps > 0),
    }))
    .filter((e) => e.name && e.sets.length);
}

function personalRecords(workouts) {
  const best = {};
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      for (const set of exercise.sets) {
        const e1rm = round1(estimate1RM(set));
        const current = best[exercise.name];
        if (!current || e1rm > current.e1rm || (e1rm === current.e1rm && set.reps > current.set.reps)) {
          best[exercise.name] = { e1rm, set, date: workout.date };
        }
      }
    }
  }
  return best;
}

function exercisesByFrequency(workouts) {
  const counts = {};
  workouts.forEach((w) => w.exercises.forEach((e) => (counts[e.name] = (counts[e.name] || 0) + 1)));
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
}

function exerciseTrend(workouts, name) {
  return sortOldestFirst(workouts).flatMap((workout) => {
    const sets = workout.exercises.filter((e) => e.name === name).flatMap((e) => e.sets);
    if (!sets.length) return [];
    return [{ date: formatShortDate(workout.date), e1rm: round1(Math.max(...sets.map(estimate1RM))) }];
  });
}

function weeklyVolume(workouts, weeks = 8) {
  const totals = {};
  workouts.forEach((w) => (totals[weekStart(w.date)] = (totals[weekStart(w.date)] || 0) + workoutVolume(w)));
  const thisMonday = parseDate(weekStart(today()));
  return Array.from({ length: weeks }, (_, i) => {
    const monday = new Date(thisMonday);
    monday.setDate(monday.getDate() - 7 * (weeks - 1 - i));
    const key = toDateKey(monday);
    return { week: formatShortDate(key), volume: Math.round(totals[key] || 0) };
  });
}

function platesPerSide(total, unit) {
  const { bar, plates } = PLATES[unit];
  let remaining = Math.max(0, (total - bar) / 2);
  const loaded = [];
  for (const plate of plates) {
    while (remaining >= plate.weight - 1e-9) {
      loaded.push(plate);
      remaining -= plate.weight;
    }
  }
  return loaded;
}

function plateSize(weight, unit) {
  const kg = unit === "kg" ? weight : weight * 0.4536;
  return { width: 6 + kg * 0.5, height: kg >= 10 ? 64 : 26 + kg * 3.5 };
}

/* ───────────────────────────── Autopilot ───────────────────────────── */

const formatRange = ([min, max]) => `${min}–${max}`;
const roundTo = (value, step) => Math.round(value / step) * step;
const repeatSet = (count, { reps, weight }) => Array.from({ length: count }, () => ({ reps, weight }));

// What an exercise is done with, read from its name. Sets the weight step and the exercise icon.
function equipmentOf(exerciseName) {
  const name = exerciseName.toLowerCase();
  if (name.includes("dumbbell")) return "dumbbell";
  if (name.includes("kettlebell")) return "kettlebell";
  if (/cable|pulldown|pushdown|crossover|face pull/.test(name)) return "cable";
  if (name.includes("machine") && !name.includes("smith")) return "machine";
  if (/pull[- ]?up|chin[- ]?up|push[- ]?up|\bdips?\b|plank|crunch|sit[- ]?up|leg raise|bodyweight/.test(name)) return "bodyweight";
  return BIG_LOWER_BODY_LIFTS.some((lift) => name.includes(lift)) ? "bigBarbell" : "barbell";
}

const weightStep = (exerciseName, unit) => EQUIPMENT_STEPS[equipmentOf(exerciseName)][unit];

// The next weight that exists: 44 → 46 on 2 kg dumbbells; an off-grid 39 → 40 on a 5 kg stack.
const nextWeightUp = (weight, step) => (Math.floor(weight / step + 1e-9) + 1) * step;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Picks the preset whose midpoint is closest to your typical working-set reps.
// Midpoints keep it stable: cycling from the bottom to the top of a range has that range's midpoint as its median.
function inferRepRange(history) {
  const typicalReps = median(history.slice(-RANGE_HISTORY_SESSIONS).flatMap((session) => session.reps));
  const distance = ([min, max]) => Math.abs((min + max) / 2 - typicalReps);
  return REP_RANGES.reduce((best, range) => (distance(range) < distance(best) ? range : best));
}

// One entry per session, oldest first. Working sets = the sets done at that session's top weight.
function workingSetHistory(workouts, name) {
  return sortOldestFirst(workouts).flatMap((workout) => {
    const sets = workout.exercises.filter((e) => e.name === name).flatMap((e) => e.sets);
    if (!sets.length) return [];
    const weight = Math.max(...sets.map((s) => s.weight));
    return [{ date: workout.date, weight, reps: sets.filter((s) => s.weight === weight).map((s) => s.reps) }];
  });
}

function prescribe(history, [min, max], step) {
  const last = history.at(-1);
  const previous = history.at(-2);
  const sets = last.reps.length;
  const lowestReps = Math.min(...last.reps);
  const missedRange = (session) => Math.min(...session.reps) < min;
  const daysOff = daysBetween(last.date, today());
  const deloadWeight = roundTo(last.weight * DELOAD_FACTOR, step);
  const plan = (status, reps, weight, reason) => ({ status, reason, target: { sets, reps, weight } });

  if (daysOff > MAX_DAYS_BEFORE_EASING_BACK && last.weight > 0)
    return plan("deload", min, deloadWeight, `${daysOff} days since you last did this. Drop 10% to ease back in.`);
  if (lowestReps >= max) return plan("increase", min, nextWeightUp(last.weight, step), `Every set reached ${max} reps.`);
  if (!missedRange(last)) return plan("reps", Math.min(max, lowestReps + 1), last.weight, `Stay at this weight until every set reaches ${max}.`);
  if (previous && previous.weight === last.weight && missedRange(previous) && last.weight > 0)
    return plan("deload", min, deloadWeight, `Missed ${min} reps two sessions running. Drop 10% and build back.`);
  return plan("repeat", min, last.weight, `Fell short of ${min} reps. Repeat the weight.`);
}

function restSeconds(exerciseName, [, maxReps]) {
  const base = REST_BY_REP_RANGE.find(([upTo]) => maxReps <= upTo)[1];
  return equipmentOf(exerciseName) === "bigBarbell" ? base + BIG_LIFT_EXTRA_REST : base;
}

function buildAutopilotPlans(workouts, { profile, repRanges = {} }) {
  return exercisesByFrequency(workouts)
    .map((name) => ({ name, history: workingSetHistory(workouts, name) }))
    .filter(({ history }) => daysBetween(history.at(-1).date, today()) <= PLAN_LOOKBACK_DAYS)
    .map(({ name, history }) => {
      const range = repRanges[name] ?? inferRepRange(history); // a range you picked always wins
      return {
        name,
        range,
        rest: restSeconds(name, range),
        last: history.at(-1),
        ...prescribe(history, range, weightStep(name, profile.unit)),
      };
    });
}

/* ───────────────────────────── Motivation ───────────────────────────── */

const SEE_TARGETS = { label: "See targets", tab: "log" };

const weeklyTarget = (profile) => Math.max(1, Math.round(Number(profile.daysPerWeek)) || 1);
// Training days in the week containing `dateKey` (a gym session and a swim on the same day count once).
const sessionsInWeekOf = (workouts, dateKey) => new Set(workouts.filter((w) => weekStart(w.date) === weekStart(dateKey)).map((w) => w.date)).size;

// ["a", "b", "c"] → "a, b and c"
const joinWords = (words) => (words.length <= 1 ? words[0] ?? "" : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);
const listNames = (names) => (names.length > 3 ? `${names.length} lifts` : joinWords(names));

// Consecutive weeks that met the weekly target, counting back from last week. This week counts once it's met.
function weeklyStreak(workouts, target) {
  const thisMonday = parseDate(weekStart(today()));
  const sessionsWeeksAgo = (weeksAgo) => {
    const monday = new Date(thisMonday);
    monday.setDate(monday.getDate() - 7 * weeksAgo);
    return sessionsInWeekOf(workouts, toDateKey(monday));
  };
  let streak = sessionsWeeksAgo(0) >= target ? 1 : 0;
  for (let weeksAgo = 1; sessionsWeeksAgo(weeksAgo) >= target; weeksAgo++) streak++;
  return streak;
}

// Best-ever lifts from the last week that beat an earlier best (a first attempt isn't a record).
function recentRecords(workouts) {
  return Object.entries(personalRecords(workouts))
    .filter(([, record]) => record.e1rm > 0 && daysBetween(record.date, today()) <= RECENT_RECORD_DAYS)
    .map(([name, record]) => ({ name, e1rm: record.e1rm, previous: personalRecords(workouts.filter((w) => w.date < record.date))[name]?.e1rm }))
    .filter((record) => record.previous !== undefined && record.e1rm > record.previous);
}

function goalFacts(goals, records, unit) {
  return goals.flatMap((goal) => {
    const current = records[goal.exercise]?.e1rm ?? 0;
    const toGo = round1(goal.target - current);
    const daysLeft = goal.deadline ? daysBetween(today(), goal.deadline) : null;
    if (toGo <= 0) return [];
    if (current >= goal.target * GOAL_CLOSE_RATIO) return [{ tone: "celebrate", text: `Only ${toGo} ${unit} to go on your ${goal.exercise} goal.` }];
    if (daysLeft !== null && daysLeft >= 0 && daysLeft <= GOAL_DUE_SOON_DAYS)
      return [{ tone: "nudge", text: `Your ${goal.exercise} goal is due in ${daysLeft} days, ${toGo} ${unit} to go.` }];
    return [];
  });
}

function weekProgressFact(count, target) {
  if (count > target) return { tone: "celebrate", text: `${count} sessions this week, beating your target of ${target}.` };
  if (count === target) return { tone: "celebrate", text: `Weekly target hit: ${count} of ${target} sessions.` };
  return { tone: "info", text: `${count} of ${target} sessions this week.` };
}

// What the Today card shows when the app opens, most actionable first.
// Each fact: { tone: "celebrate" | "nudge" | "info", text, action?: { label, tab } }
function todayFacts({ workouts, settings, records, plans }) {
  const { profile, goals } = settings;
  if (!workouts.length) {
    return [{ tone: "nudge", text: "Log your first workout and Autopilot will set your targets.", action: { label: "Log one", tab: "log" } }];
  }
  const target = weeklyTarget(profile);
  const daysAway = daysBetween(sortNewestFirst(workouts)[0].date, today());
  const streak = weeklyStreak(workouts, target);
  const increases = plans.filter((p) => p.status === "increase").map((p) => p.name);
  const plan = todayPlan(profile, workouts);
  const checkIn = pendingCheckIn(workouts);
  const START = { label: "Start", tab: "log" };

  return [
    plan.status === "planned" && {
      tone: "plan",
      text: `Workout planned today${plan.time ? ` at ${plan.time}` : ""}. ${plans.length} exercises are ready in Up next.`,
      action: START,
    },
    plan.status === "late" && { tone: "nudge", text: `Today's ${plan.time} session hasn't happened yet. A shorter one still counts.`, action: START },
    plan.status === "rest" && { tone: "info", text: "Rest day. Recovery is when the strength gets built." },
    checkIn && { tone: "nudge", text: `How did your ${formatShortDate(checkIn.date)} workout feel? Your coach would like to know.`, action: { label: "Check in", tab: "log" } },
    plan.status === "unscheduled" && daysAway > Math.ceil(7 / target) && {
      tone: "nudge",
      text: `${daysAway} days since your last session. Your targets are ready when you are.`,
      action: SEE_TARGETS,
    },
    ...recentRecords(workouts).map((r) => ({
      tone: "celebrate",
      text: `New best this week on ${r.name}: est. 1RM ${r.e1rm} ${profile.unit}, up ${round1(r.e1rm - r.previous)} ${profile.unit}.`,
    })),
    increases.length > 0 && { tone: "celebrate", text: `You've earned a weight increase on ${listNames(increases)}.`, action: SEE_TARGETS },
    ...goalFacts(goals, records, profile.unit),
    streak >= 2 && { tone: "celebrate", text: `${streak} weeks in a row on target.` },
    weekProgressFact(sessionsInWeekOf(workouts, today()), target),
  ].filter(Boolean);
}

// What to celebrate right after a session is saved.
function sessionHighlights(workout, earlierWorkouts, settings) {
  const { unit } = settings.profile;
  const all = [...earlierWorkouts, workout];
  const before = personalRecords(earlierWorkouts);
  const after = personalRecords(all);
  const names = [...new Set(workout.exercises.map((e) => e.name))];
  const increases = buildAutopilotPlans(all, settings).filter((p) => p.status === "increase" && names.includes(p.name));
  const isThisWeek = weekStart(workout.date) === weekStart(today());
  const earlierActivities = earlierWorkouts.flatMap((w) => w.activities ?? []);
  const activityFacts = (workout.activities ?? []).flatMap((a) => {
    const pace = paceText(a);
    const longest = Math.max(0, ...earlierActivities.filter((p) => p.type === a.type && p.distanceUnit === a.distanceUnit).map((p) => p.distance || 0));
    return [
      { tone: "celebrate", text: `${activityLabel(a)}${pace ? ` (${pace})` : ""} logged.` },
      a.distance && longest > 0 && a.distance > longest && { tone: "celebrate", text: `Your longest ${activityType(a.type).noun ?? a.type.toLowerCase()} yet, beating ${longest} ${a.distanceUnit}.` },
    ];
  });

  return [
    ...activityFacts,
    ...names
      .filter((name) => before[name] && after[name].e1rm > before[name].e1rm)
      .map((name) => ({
        tone: "celebrate",
        text: `New best on ${name}: est. 1RM ${after[name].e1rm} ${unit}, up ${round1(after[name].e1rm - before[name].e1rm)} ${unit}.`,
      })),
    ...increases.map((p) => ({ tone: "celebrate", text: `${p.name} goes up to ${p.target.weight} ${unit} next time.` })),
    MILESTONES.includes(all.length) && { tone: "celebrate", text: `That's ${all.length} sessions logged.` },
    isThisWeek && weekProgressFact(sessionsInWeekOf(all, workout.date), weeklyTarget(settings.profile)),
  ].filter(Boolean);
}

/* ───────────────────────────── Muscles ───────────────────────────── */

function ruleMuscles(exerciseName) {
  const name = exerciseName.toLowerCase();
  const rule = MUSCLE_RULES.find((r) => r.match.test(name));
  return rule ? { primary: rule.primary, secondary: rule.secondary } : null;
}

// Built-in rules first, then what the coach classified. Null if the exercise is still unknown.
const musclesFor = (exerciseName, learned) => ruleMuscles(exerciseName) ?? learned[exerciseName] ?? null;

function sanitizeMuscles(raw) {
  const valid = (list) => (Array.isArray(list) ? list.filter((m) => MUSCLES.includes(m)) : []);
  return { primary: valid(raw?.primary), secondary: valid(raw?.secondary) };
}

// Sets per muscle over the last 7 days: a set counts fully for its main muscles and half for helpers.
function weeklyMuscleSets(workouts, learned) {
  const totals = Object.fromEntries(MUSCLES.map((m) => [m, 0]));
  for (const workout of workouts.filter((w) => daysBetween(w.date, today()) < 7)) {
    for (const exercise of workout.exercises) {
      const muscles = musclesFor(exercise.name, learned);
      if (!muscles) continue;
      muscles.primary.forEach((m) => (totals[m] += exercise.sets.length));
      muscles.secondary.forEach((m) => (totals[m] += exercise.sets.length / 2));
    }
  }
  return totals;
}

const volumeColor = (sets) => VOLUME_LEVELS.find((level) => sets >= level.min)?.color ?? MUSCLE_COLORS.idle;
const formatSets = (sets) => (Number.isInteger(sets) ? String(sets) : sets.toFixed(1));

// "Chest, with triceps and shoulders"
function describeMuscles({ primary, secondary }) {
  const words = (muscles) => joinWords(muscles.map((m) => MUSCLE_LABELS[m].toLowerCase()));
  const text = secondary.length ? `${words(primary)}, with ${words(secondary)}` : words(primary);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ───────────────────────────── Live workout ───────────────────────────── */

// The workout in progress. It's saved as you go, so closing the app mid-session loses nothing.
// { date, startedAt, notes, exercises: [{ id, name, rest, sets: [{ id, weight, reps, done }] }] }
// Weights and reps may be strings while being typed; they become numbers when the workout is saved.
const newId = () => crypto.randomUUID();
const newSet = ({ weight, reps }, done = false) => ({ id: newId(), weight, reps, done });
const startSession = () => ({ date: today(), startedAt: Date.now(), notes: "", exercises: [] });

// `sets` are { weight, reps } pairs; `done` marks them as already lifted (when logging after the fact).
function sessionExercise(name, sets, { done = false, rest } = {}) {
  const firstReps = Number(sets[0]?.reps) || 8;
  return { id: newId(), name, rest: rest ?? restSeconds(name, [0, firstReps]), sets: sets.map((set) => newSet(set, done)) };
}

const planExercise = (plan) => sessionExercise(plan.name, repeatSet(plan.target.sets, plan.target), { rest: plan.rest });

// Everything in Up next, in that order, at Autopilot's targets. Remove, reorder or edit once started.
const planSession = (plans) => ({ ...startSession(), exercises: plans.map(planExercise) });

// Your last workout's exercises, in the same order, at today's Autopilot targets where there is one.
function repeatLastWorkout(workouts, plans) {
  const last = lastGymWorkout(workouts);
  const planFor = (name) => plans.find((plan) => plan.name === name);
  const exercises = (last?.exercises ?? []).map((e) => (planFor(e.name) ? planExercise(planFor(e.name)) : sessionExercise(e.name, e.sets)));
  return { ...startSession(), exercises };
}

// Small, pure updates. Each returns a new session.
const withExercises = (session, update) => ({ ...session, exercises: update(session.exercises) });
const withExercise = (session, exerciseId, update) => withExercises(session, (list) => list.map((e) => (e.id === exerciseId ? update(e) : e)));
const withSet = (session, exerciseId, setId, update) =>
  withExercise(session, exerciseId, (e) => ({ ...e, sets: e.sets.map((set) => (set.id === setId ? update(set) : set)) }));

function moveItem(list, index, offset) {
  const target = index + offset;
  if (index < 0 || target < 0 || target >= list.length) return list;
  const moved = [...list];
  [moved[index], moved[target]] = [moved[target], moved[index]];
  return moved;
}

const addExercises = (session, exercises) => withExercises(session, (list) => [...list, ...exercises]);
const removeExercise = (session, exerciseId) => withExercises(session, (list) => list.filter((e) => e.id !== exerciseId));
const moveExercise = (session, exerciseId, offset) =>
  withExercises(session, (list) => moveItem(list, list.findIndex((e) => e.id === exerciseId), offset));
const toggleSet = (session, exerciseId, setId) => withSet(session, exerciseId, setId, (set) => ({ ...set, done: !set.done }));
const editSet = (session, exerciseId, setId, field, value) => withSet(session, exerciseId, setId, (set) => ({ ...set, [field]: value }));
const addSet = (session, exerciseId) =>
  withExercise(session, exerciseId, (e) => ({ ...e, sets: [...e.sets, newSet(e.sets.at(-1) ?? { weight: 0, reps: 8 })] }));
const removeSet = (session, exerciseId, setId) => withExercise(session, exerciseId, (e) => ({ ...e, sets: e.sets.filter((set) => set.id !== setId) }));
const completeExercise = (session, exerciseId) => withExercise(session, exerciseId, (e) => ({ ...e, sets: e.sets.map((set) => ({ ...set, done: true })) }));

function sessionSetCounts(session) {
  const sets = session.exercises.flatMap((e) => e.sets);
  return { done: sets.filter((set) => set.done).length, total: sets.length };
}

// A saved workout as an editable session, so the same cards can fix it.
function workoutToSession(workout) {
  return {
    date: workout.date,
    startedAt: null,
    notes: workout.notes ?? "",
    exercises: workout.exercises.map((e) => sessionExercise(e.name, e.sets, { done: true })),
  };
}

// The exercise you're on: the first one with sets still to do.
const currentExerciseId = (session) => session.exercises.find((e) => e.sets.some((set) => !set.done))?.id ?? null;

// Only sets marked done are saved (or every set, when editing a saved workout); empty exercises are left out.
function sessionToWorkout(session, { allSets = false } = {}) {
  const doneSets = (sets) =>
    sets
      .filter((set) => allSets || set.done)
      .map((set) => ({ weight: Number(set.weight) || 0, reps: Math.round(Number(set.reps)) || 0 }))
      .filter((set) => set.reps > 0);
  return {
    id: newId(),
    date: session.date,
    notes: session.notes.trim(),
    exercises: session.exercises.map((e) => ({ name: e.name, sets: doneSets(e.sets) })).filter((e) => e.sets.length),
  };
}

/* ───────────────────────────── Schedule, check-ins & forecasts ───────────────────────────── */

// Today against the training schedule: "planned", "late" (2+ hours past the planned time), "done", "rest" or "unscheduled".
function todayPlan(profile, workouts, now = new Date()) {
  const days = profile.trainingDays ?? [];
  const time = profile.trainingTime || "";
  if (workouts.some((w) => w.date === today())) return { status: "done" };
  if (!days.length) return { status: "unscheduled" };
  if (!days.includes(now.getDay())) return { status: "rest" };
  if (time) {
    const [hours, minutes] = time.split(":").map(Number);
    const planned = new Date(now);
    planned.setHours(hours, minutes, 0, 0);
    if (now - planned > LATE_AFTER_HOURS * 3_600_000) return { status: "late", time };
  }
  return { status: "planned", time };
}

// The latest workout, if it's recent and you haven't told the coach how it went.
function pendingCheckIn(workouts) {
  const latest = sortNewestFirst(workouts)[0];
  return latest && !latest.checkIn && daysBetween(latest.date, today()) <= CHECK_IN_WINDOW_DAYS ? latest : null;
}

// Straight-line trend of an exercise's best estimated 1RM per session over the last 12 weeks
// (least squares, x = days from today). Null when there's too little data to say anything honest.
function strengthTrend(workouts, exercise) {
  const points = sortOldestFirst(workouts)
    .filter((w) => daysBetween(w.date, today()) <= FORECAST_LOOKBACK_DAYS)
    .flatMap((w) => {
      const sets = w.exercises.filter((e) => e.name === exercise).flatMap((e) => e.sets);
      return sets.length ? [{ x: daysBetween(today(), w.date), y: Math.max(...sets.map(estimate1RM)) }] : [];
    });
  if (points.length < FORECAST_MIN_SESSIONS || points.at(-1).x - points[0].x < FORECAST_MIN_SPAN_DAYS) return null;
  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const meanX = mean(points.map((p) => p.x));
  const meanY = mean(points.map((p) => p.y));
  const perDay = points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0) / points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);
  return { perDay, todayValue: meanY - perDay * meanX };
}

function addDays(dateKey, days) {
  const d = parseDate(dateKey);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

// When a goal is reached if the recent rate of progress continues.
function goalForecast(workouts, goal, current) {
  if (current >= goal.target) return { status: "reached" };
  const trend = strengthTrend(workouts, goal.exercise);
  if (!trend) return { status: "not-enough-data" };
  const weeklyGain = trend.perDay * 7;
  if (weeklyGain < FORECAST_MIN_WEEKLY_GAIN) return { status: "flat" };
  const days = Math.max(7, Math.ceil((goal.target - trend.todayValue) / trend.perDay));
  if (days > FORECAST_MAX_DAYS) return { status: "far", weeklyGain };
  const date = addDays(today(), days);
  const daysLeft = goal.deadline ? daysBetween(today(), goal.deadline) : null;
  return {
    status: "forecast",
    date,
    weeklyGain,
    daysVsDeadline: goal.deadline ? daysBetween(goal.deadline, date) : null, // > 0 means after the deadline
    neededWeeklyGain: daysLeft > 0 ? ((goal.target - trend.todayValue) / daysLeft) * 7 : null,
  };
}

const spanText = (days) => (Math.abs(days) < 14 ? `${Math.abs(days)} days` : `${Math.round(Math.abs(days) / 7)} weeks`);

function forecastText(forecast, unit) {
  switch (forecast.status) {
    case "forecast": {
      const { date, weeklyGain, daysVsDeadline, neededWeeklyGain } = forecast;
      const deadline =
        daysVsDeadline === null ? "" : daysVsDeadline <= 0 ? `, ${spanText(daysVsDeadline)} before your deadline` : `, ${spanText(daysVsDeadline)} after your deadline`;
      const needed = daysVsDeadline > 0 && neededWeeklyGain ? ` To make the deadline you'd need about ${round1(neededWeeklyGain)} ${unit} a week.` : "";
      return `Forecast: around ${formatLongDate(date)}${deadline}. You're gaining about ${round1(weeklyGain)} ${unit} a week.${needed}`;
    }
    case "far":
      return `Forecast: more than a year away at about ${round1(forecast.weeklyGain)} ${unit} a week.`;
    case "flat":
      return "Forecast: progress on this lift has been flat lately, so no date yet.";
    case "not-enough-data":
      return "Forecast: log this lift a few more times over 2+ weeks to get one.";
    default:
      return "";
  }
}

/* ───────────────────────────── Activities ───────────────────────────── */

// An activity: { id, type, minutes, distance (or null), distanceUnit (or null), effort (or null) }.
// It lives in a workout's `activities`, next to (or instead of) gym `exercises`.
const activityType = (type) => ACTIVITY_TYPES.find((t) => t.type === type) ?? ACTIVITY_TYPES.at(-1);
const distanceUnitFor = (type, unit) => activityType(type).distance?.[unit] ?? null;
const activityLabel = (a) => `${a.type} ${a.minutes} min${a.distance ? `, ${a.distance} ${a.distanceUnit}` : ""}`;
const activityEntry = (date, activities, notes = "") => ({ id: newId(), date, exercises: [], activities, notes });
const lastGymWorkout = (workouts) => sortNewestFirst(workouts).find((w) => w.exercises.length > 0) ?? null;

function formatPace(minutes) {
  const seconds = Math.round(minutes * 60);
  return `${Math.floor(seconds / 60)}:${pad2(seconds % 60)}`;
}

// Pace the way each sport reads it: running per km/mi, swimming per 100, rowing per 500, cycling as speed.
function paceText({ type, minutes, distance, distanceUnit }) {
  if (!distance || !minutes) return "";
  switch (activityType(type).pace) {
    case "perUnit":
      return `${formatPace(minutes / distance)} /${distanceUnit}`;
    case "per100":
      return `${formatPace((minutes / distance) * 100)} /100 ${distanceUnit}`;
    case "per500":
      return `${formatPace((minutes / distance) * 500)} /500 ${distanceUnit}`;
    case "speed":
      return `${round1(distance / (minutes / 60))} ${distanceUnit}/h`;
    default:
      return "";
  }
}

function sanitizeActivities(raw) {
  const units = ["km", "mi", "m", "yd"];
  return (raw?.activities ?? [])
    .map((a) => {
      const type = ACTIVITY_TYPES.find((t) => t.type.toLowerCase() === String(a.type ?? "").toLowerCase())?.type ?? "Other";
      const distance = Number(a.distance) || null;
      const distanceUnit = distance && units.includes(a.distanceUnit) ? a.distanceUnit : null;
      return {
        id: newId(),
        type,
        minutes: Math.round(Number(a.minutes) || 0),
        distance: distanceUnit ? distance : null,
        distanceUnit,
        effort: ACTIVITY_EFFORTS.includes(a.effort) ? a.effort : null,
      };
    })
    .filter((a) => a.minutes > 0);
}

// Per activity type over the last `days` days: { type, count, minutes, distances: { [unit]: total } }, most minutes first.
function activitySummary(workouts, days = 7) {
  const totals = {};
  for (const workout of workouts.filter((w) => daysBetween(w.date, today()) < days)) {
    for (const a of workout.activities ?? []) {
      if (!totals[a.type]) totals[a.type] = { type: a.type, count: 0, minutes: 0, distances: {} };
      const total = totals[a.type];
      total.count += 1;
      total.minutes += a.minutes;
      if (a.distance) total.distances[a.distanceUnit] = round1((total.distances[a.distanceUnit] ?? 0) + a.distance);
    }
  }
  return Object.values(totals).sort((a, b) => b.minutes - a.minutes);
}

const summaryText = (s) =>
  [`${s.count} ${s.count === 1 ? "session" : "sessions"}`, `${s.minutes} min`, ...Object.entries(s.distances).map(([unit, d]) => `${d} ${unit}`)].join(", ");

/* ───────────────────────────── Import ───────────────────────────── */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const parseNumber = (value) => Number(String(value ?? "").replace(",", ".")) || 0;

// Handles "2024-08-21 18:05:00" (Strong), "21 Aug 2024, 18:05" (Hevy) and anything else the browser can parse.
function dateKeyFromText(value) {
  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;
  const dayFirst = text.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})/i);
  const month = dayFirst && MONTHS.indexOf(dayFirst[2].toLowerCase());
  if (dayFirst && month >= 0) return `${dayFirst[3]}-${pad2(month + 1)}-${pad2(dayFirst[1])}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : toDateKey(parsed);
}

function convertWeight(weight, fromUnit, toUnit) {
  if (fromUnit === toUnit) return weight;
  return roundTo(fromUnit === "lb" ? weight * 0.453592 : weight * 2.20462, 0.5);
}

// A row's weight unit: from the column name ("weight_lbs"), a per-row unit column, or the athlete's default.
function rowUnit(row, columns, fallbackUnit) {
  const hint = `${columns.weight ?? ""} ${columns.weightUnit ? row[columns.weightUnit] : ""}`.toLowerCase();
  if (hint.includes("lb")) return "lb";
  if (hint.includes("kg")) return "kg";
  return fallbackUnit;
}

function detectColumns(headers) {
  const find = (aliases) => headers.find((header) => aliases.includes(header.toLowerCase())) ?? null;
  return Object.fromEntries(Object.entries(COLUMN_ALIASES).map(([field, aliases]) => [field, find(aliases)]));
}

const hasRequiredColumns = (columns) => Boolean(columns.date && columns.exercise && columns.reps);

// Unknown layout: Claude only maps the columns; parsing stays local and deterministic.
async function mapColumnsWithClaude(headers, rows) {
  const sample = [headers, ...rows.slice(0, 5).map((row) => headers.map((h) => row[h]))].map((cells) => cells.join(",")).join("\n");
  const mapping = await askClaudeForJson(COLUMN_MAPPER_PROMPT, sample);
  return Object.fromEntries(Object.keys(COLUMN_ALIASES).map((field) => [field, headers.includes(mapping[field]) ? mapping[field] : null]));
}

// One row per set in, one workout per day out (same-day sessions are merged).
function rowsToWorkouts(rows, columns, unit) {
  const days = new Map(); // date -> Map(exercise name -> sets)
  let skipped = 0;
  for (const row of rows) {
    const date = dateKeyFromText(row[columns.date]);
    const name = cleanExerciseName(row[columns.exercise]);
    const reps = Math.round(parseNumber(row[columns.reps]));
    const isWarmup = columns.setType && /warm/i.test(row[columns.setType] ?? "");
    if (!date || !name || reps <= 0 || isWarmup) {
      skipped++;
      continue;
    }
    const weight = convertWeight(parseNumber(columns.weight ? row[columns.weight] : 0), rowUnit(row, columns, unit), unit);
    if (!days.has(date)) days.set(date, new Map());
    const exercises = days.get(date);
    exercises.set(name, [...(exercises.get(name) ?? []), { reps, weight }]);
  }
  const workouts = [...days].map(([date, exercises]) => ({
    date,
    exercises: [...exercises].map(([name, sets]) => ({ name, sets })),
    notes: "",
    source: "import",
  }));
  return { workouts, skipped };
}

async function workoutsFromCsv(text, unit) {
  const { data: rows, meta } = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
  });
  const headers = meta.fields ?? [];
  let columns = detectColumns(headers);
  if (!hasRequiredColumns(columns)) columns = await mapColumnsWithClaude(headers, rows);
  if (!hasRequiredColumns(columns)) throw new Error("Couldn't find date, exercise and reps columns in this file.");
  return rowsToWorkouts(rows, columns, unit);
}

const toSet = (set) => (Array.isArray(set) ? { weight: set[0], reps: set[1] } : set); // [weight, reps] or {weight, reps}

async function workoutsFromScreenshot(file, unit) {
  const tiles = await screenshotToTiles(file);
  const instructions = [
    tiles.length > 1 && `These ${tiles.length} images are consecutive slices of one long screenshot, top to bottom, overlapping slightly. Count each set once.`,
    `Today is ${today()}. Give weights in ${unit}, converting if the app shows the other unit.`,
  ];
  const content = [...tiles.map(imageBlock), { type: "text", text: instructions.filter(Boolean).join("\n") }];
  const parsed = await askClaudeForJson(SCREENSHOT_IMPORT_PROMPT, content);
  return (parsed.workouts ?? [])
    .map((w) => ({
      date: dateKeyFromText(w.date),
      exercises: sanitizeExercises({ exercises: (w.exercises ?? []).map((e) => ({ name: e.name, sets: (e.sets ?? []).map(toSet) })) }),
      notes: "",
      source: "import",
    }))
    .filter((w) => w.date && w.exercises.length);
}

function mergeSameDay(workouts) {
  const byDate = new Map();
  for (const w of workouts) {
    const sameDay = byDate.get(w.date);
    byDate.set(w.date, sameDay ? { ...sameDay, exercises: [...sameDay.exercises, ...w.exercises] } : w);
  }
  return [...byDate.values()];
}

async function workoutsFromScreenshots(files, unit) {
  const perScreenshot = await Promise.all(files.map((file) => workoutsFromScreenshot(file, unit)));
  return { workouts: mergeSameDay(perScreenshot.flat()), skipped: 0 };
}

// Android often labels CSVs "text/comma-separated-values" or "application/vnd.ms-excel", so check loosely.
const looksLikeCsv = (file) => /\.(csv|txt)$/i.test(file.name) || /csv|text|excel/i.test(file.type);

async function readImportFiles(files, unit) {
  const csv = files.find(looksLikeCsv);
  if (csv) return workoutsFromCsv(await csv.text(), unit);
  const images = files.filter((file) => file.type.startsWith("image/")).slice(0, MAX_IMPORT_SCREENSHOTS);
  if (images.length) return workoutsFromScreenshots(images, unit);
  throw new Error("Choose a CSV export or screenshots of your workouts.");
}

const workoutFingerprint = (w) =>
  `${w.date}|${w.exercises.map((e) => `${e.name}:${e.sets.map((s) => `${s.weight}x${s.reps}`).join(",")}`).join(";")}`;

function withoutDuplicates(incoming, existing) {
  const known = new Set(existing.map(workoutFingerprint));
  return incoming.filter((w) => !known.has(workoutFingerprint(w)));
}

/* ───────────────────────────── Coach context ───────────────────────────── */

function formatWorkoutLine(w) {
  const checkIn = w.checkIn && !w.checkIn.skipped ? ` (felt: ${w.checkIn.effort}; pain: ${w.checkIn.pain}${w.checkIn.note ? `; ${w.checkIn.note}` : ""})` : "";
  const lifts = w.exercises.map((e) => `${e.name} ${e.sets.map((s) => `${s.weight}x${s.reps}`).join(", ")}`);
  const activities = (w.activities ?? []).map((a) => `${activityLabel(a)}${a.effort ? ` (${a.effort.toLowerCase()})` : ""}`);
  return `${w.date}: ${[...lifts, ...activities].join("; ")}` + (w.notes ? ` (notes: ${w.notes})` : "") + checkIn;
}

function buildCoachContext({ profile, goals }, workouts, plans, learnedMuscles, session) {
  const u = profile.unit;
  const formatWorkout = formatWorkoutLine;
  const schedule = (profile.trainingDays ?? []).length
    ? `trains ${WEEKDAYS.filter((d) => profile.trainingDays.includes(d.day)).map((d) => d.label).join(", ")}${profile.trainingTime ? ` at ${profile.trainingTime}` : ""}`
    : `aims for ${profile.daysPerWeek} sessions/week`;
  const plan = todayPlan(profile, workouts);
  const todayLine = {
    planned: `a workout is planned today${plan.time ? ` at ${plan.time}` : ""} and not done yet`,
    late: `a workout was planned today at ${plan.time} and hasn't happened yet`,
    done: "they already trained today",
    rest: "rest day",
    unscheduled: "no schedule set",
  }[plan.status];
  const forecasts = goals.map((g) => `- ${g.exercise} ${g.target}${u}: ${forecastText(goalForecast(workouts, g, personalRecords(workouts)[g.exercise]?.e1rm ?? 0), u) || "reached"}`);
  const records = Object.entries(personalRecords(workouts)).map(
    ([name, r]) => `- ${name}: ${r.e1rm}${u} est. 1RM (${r.set.weight}x${r.set.reps} on ${r.date})`
  );
  const goalLines = goals.map((g) => `- ${g.exercise} ${g.target}${u} 1RM${g.deadline ? ` by ${g.deadline}` : ""}`);
  const recent = sortNewestFirst(workouts).slice(0, 40).map(formatWorkout);
  const targets = plans.map(
    (p) => `- ${p.name}: ${p.target.sets}x${p.target.reps} @ ${p.target.weight}${u} (${PLAN_STATUS[p.status].label.toLowerCase()}, rep range ${formatRange(p.range)}, rest ${formatClock(p.rest)})`
  );

  return [
    `Today is ${today()}. Weights are in ${u}, written weight x reps; dumbbell weights are per dumbbell.`,
    `ATHLETE: ${profile.experience}, bodyweight ${profile.bodyweight || "unknown"}${u}, ${schedule}, focus: ${profile.focus}, coaching style: ${COACH_STYLES[profile.coachStyle ?? DEFAULT_SETTINGS.profile.coachStyle]}.`,
    profile.notes && `ATHLETE NOTES: ${profile.notes}`,
    profile.foodNotes && `FOOD PREFERENCES: ${profile.foodNotes}`,
    `TODAY: ${todayLine}.`,
    `GOALS:\n${goalLines.join("\n") || "none set"}`,
    goals.length > 0 && `GOAL FORECASTS (straight line from the last 12 weeks; gains usually slow over time):\n${forecasts.join("\n")}`,
    `BEST LIFTS:\n${records.join("\n") || "none yet"}`,
    `AUTOPILOT TARGETS FOR NEXT TIME (double progression):\n${targets.join("\n") || "none yet"}`,
    session &&
      `WORKOUT IN PROGRESS (in order, weight x reps): ${
        session.exercises
          .map((e) => `${e.name} ${e.sets.map((set) => `${set.weight}x${set.reps}${set.done ? " done" : " to do"}`).join(", ")}`)
          .join("; ") || "just started"
      }`,
    `SETS PER MUSCLE, LAST 7 DAYS (main muscle 1, helper 0.5): ${Object.entries(weeklyMuscleSets(workouts, learnedMuscles))
      .map(([m, sets]) => `${MUSCLE_LABELS[m]} ${formatSets(sets)}`)
      .join(", ")}`,
    `ACTIVITIES, LAST 7 DAYS: ${activitySummary(workouts).map((s) => `${s.type}: ${summaryText(s)}`).join("; ") || "none"}`,
    `RECENT WORKOUTS (newest first):\n${recent.join("\n") || "none logged yet"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* ───────────────────────────── UI primitives ───────────────────────────── */

const inputClass =
  "w-full rounded-lg bg-white border border-zinc-300 px-3 py-2.5 text-base text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-700";

function Panel({ children, className = "" }) {
  return <section className={`rounded-2xl bg-white p-4 ${className}`}>{children}</section>;
}

function ViewTitle({ children, action }) {
  return (
    <div className="flex items-end justify-between mb-4">
      <h1 className="gb-display text-4xl font-extrabold text-zinc-900 leading-none">{children}</h1>
      {action}
    </div>
  );
}

const SectionTitle = ({ children }) => <h2 className="gb-display text-2xl font-bold text-zinc-900 mb-2">{children}</h2>;

function Field({ label, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-sm text-zinc-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Select({ value, options, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      {options.map((option) => (
        <option key={option}>{option}</option>
      ))}
    </select>
  );
}

function PrimaryButton({ children, onClick, busy = false, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-700 text-white font-semibold py-3 disabled:opacity-40"
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

// The real <input> covers the whole drop zone (invisible), so a tap lands on it directly.
// In-app browsers often ignore a <label> forwarding clicks to a display:none input.
function FilePicker({ title, hint, accept, busy = false, onFiles }) {
  function handleChange(event) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // allow picking the same file again
    if (files.length) onFiles(files);
  }

  return (
    <div className="relative flex flex-col items-center gap-1 rounded-xl border-2 border-dashed border-zinc-300 px-6 py-7 text-center">
      {busy ? <Loader2 className="w-6 h-6 animate-spin text-zinc-500" /> : <Upload className="w-6 h-6 text-zinc-500" />}
      <span className="font-semibold text-zinc-800">{title}</span>
      {hint && <span className="text-sm text-zinc-500">{hint}</span>}
      <input
        type="file"
        accept={accept}
        multiple
        disabled={busy}
        onChange={handleChange}
        aria-label={title}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </div>
  );
}

// Two-step confirm: the first tap arms it for 3 seconds, the second tap acts.
function useArmed() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  return [armed, () => setArmed(true)];
}

function DeleteButton({ onConfirm, label = "Delete" }) {
  const [armed, arm] = useArmed();
  return armed ? (
    <button onClick={onConfirm} className="text-sm font-semibold text-red-600">
      Tap to delete
    </button>
  ) : (
    <button onClick={arm} aria-label={label} className="text-zinc-400 hover:text-red-600">
      <Trash2 className="w-4 h-4" />
    </button>
  );
}

const ErrorText = ({ message }) => (message ? <p className="text-sm text-red-600">{message}</p> : null);

function renderBold(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-zinc-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  );
}

// Minimal markdown: headings, "- " bullets and **bold**.
function RichText({ text }) {
  const lines = text.split("\n").filter((line) => line.trim());
  return (
    <div className="space-y-1.5 leading-relaxed">
      {lines.map((line, i) => {
        const isBullet = /^\s*[-*•]\s+/.test(line);
        const videoExercise = line.match(VIDEO_MARKER)?.[1];
        if (videoExercise) {
          const guide = guideFor(videoExercise);
          return guide ? <VideoGuides key={i} guide={guide} /> : null; // not in the library: show nothing
        }
        const isHeading = /^#{1,4}\s/.test(line);
        const content = renderBold(line.replace(/^\s*[-*•]\s+/, "").replace(/^#{1,4}\s/, ""));
        if (isHeading) return <p key={i} className="font-semibold text-zinc-900 pt-1">{content}</p>;
        if (isBullet)
          return (
            <div key={i} className="flex gap-2">
              <span className="text-blue-700">–</span>
              <span>{content}</span>
            </div>
          );
        return <p key={i}>{content}</p>;
      })}
    </div>
  );
}

/* ───────────────────────────── Motivation UI ───────────────────────────── */

const TONE_DOT = { plan: "bg-blue-600", celebrate: "bg-green-500", nudge: "bg-amber-500", info: "bg-zinc-400" };

function FactList({ facts, onAction }) {
  return (
    <ul className="space-y-2">
      {facts.map((fact, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[fact.tone]}`} />
          <span className="flex-1">{fact.text}</span>
          {fact.action && onAction && (
            <button onClick={() => onAction(fact.action)} className="shrink-0 text-sm font-semibold text-blue-700">
              {fact.action.label}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// Once a day the coach writes a short note from today's facts. Cached, so reopening the app costs nothing.
function useDailyNote({ enabled, facts, context, style }) {
  const [note, setNote, noteLoaded] = usePersistentState(STORAGE_KEYS.dailyNote, null); // { key, text }
  const [failed, setFailed] = useState(false);
  const requestedKey = useRef(null);
  const key = `${today()}|${style}`;
  const isFresh = note?.key === key;

  useEffect(() => {
    if (!enabled || !noteLoaded || isFresh || requestedKey.current === key) return;
    requestedKey.current = key;
    setFailed(false);
    const highlights = facts.map((fact) => `- ${fact.text}`).join("\n");
    askClaude(`${MOTIVATION_PROMPT}\nStyle: ${COACH_STYLES[style]}.`, [{ role: "user", content: `TODAY'S HIGHLIGHTS:\n${highlights}\n\n${context}` }])
      .then((text) => setNote({ key, text }))
      .catch(() => setFailed(true)); // the facts still show; the note is a bonus
  }, [enabled, noteLoaded, isFresh, key]); // facts/context are read once per day on purpose

  return { text: isFresh ? note.text : null, loading: enabled && !isFresh && !failed };
}

function TodayCard({ facts, note, onNavigate }) {
  return (
    <Panel className="mb-4 space-y-3">
      <SectionTitle>Today</SectionTitle>
      {note.text && <p className="-mt-1 text-lg leading-snug text-zinc-900">{note.text}</p>}
      {note.loading && <p className="-mt-1 text-zinc-400">Your coach is writing today's note.</p>}
      <FactList facts={facts.slice(0, MAX_TODAY_FACTS)} onAction={(action) => onNavigate(action.tab)} />
    </Panel>
  );
}

function SessionHighlights({ facts, onClose }) {
  return (
    <section className="rounded-2xl bg-zinc-900 p-4 text-white">
      <div className="mb-2 flex items-start justify-between">
        <h2 className="gb-display text-2xl font-bold">Session saved</h2>
        <button onClick={onClose} aria-label="Close" className="text-zinc-400">
          <X className="w-5 h-5" />
        </button>
      </div>
      <FactList facts={facts} />
    </section>
  );
}

/* ───────────────────────────── Muscle visuals ───────────────────────────── */

// An original, stylised front and back figure. Shapes are drawn for the left half (centre line x = 50)
// and mirrored; `center` shapes sit on the centre line and are drawn once.
const BODY_VIEWS = {
  front: {
    body: [
      { tag: "circle", center: true, attrs: { cx: 50, cy: 13, r: 9 } },
      { tag: "rect", center: true, attrs: { x: 46, y: 21, width: 8, height: 7, rx: 2 } },
      { tag: "path", center: true, attrs: { d: "M39 87 L61 87 L59 97 L50 101 L41 97 Z" } },
      { tag: "circle", attrs: { cx: 20.5, cy: 93, r: 4 } },
      { tag: "ellipse", attrs: { cx: 43, cy: 145, rx: 4.5, ry: 5 } },
      { tag: "ellipse", attrs: { cx: 42, cy: 190, rx: 6, ry: 3.5 } },
    ],
    muscles: [
      { id: "traps", tag: "path", attrs: { d: "M45 26 L47 31 L37 32 Z" } },
      { id: "shoulders", tag: "ellipse", attrs: { cx: 31, cy: 38, rx: 7, ry: 8 } },
      { id: "chest", tag: "path", attrs: { d: "M49 34 L39 33 Q34 38 36 47 Q42 52 49 50 Z" } },
      { id: "biceps", tag: "ellipse", attrs: { cx: 27, cy: 55, rx: 4.5, ry: 10 } },
      { id: "forearms", tag: "path", attrs: { d: "M23 66 L29 66 L25 88 L19 87 Z" } },
      { id: "core", tag: "rect", center: true, attrs: { x: 41, y: 53, width: 18, height: 32, rx: 5 } },
      { id: "quads", tag: "path", attrs: { d: "M38 101 Q34 118 38 139 L47 139 Q50 120 48 102 Z" } },
      { id: "calves", tag: "ellipse", attrs: { cx: 42, cy: 167, rx: 4.5, ry: 16 } },
    ],
  },
  back: {
    body: [
      { tag: "circle", center: true, attrs: { cx: 50, cy: 13, r: 9 } },
      { tag: "rect", center: true, attrs: { x: 46, y: 21, width: 8, height: 7, rx: 2 } },
      { tag: "circle", attrs: { cx: 20.5, cy: 93, r: 4 } },
      { tag: "ellipse", attrs: { cx: 43, cy: 145, rx: 4.5, ry: 5 } },
      { tag: "ellipse", attrs: { cx: 42, cy: 190, rx: 6, ry: 3.5 } },
    ],
    muscles: [
      { id: "traps", tag: "path", attrs: { d: "M50 24 L37 32 L50 46 Z" } },
      { id: "shoulders", tag: "ellipse", attrs: { cx: 31, cy: 38, rx: 7, ry: 8 } },
      { id: "upperBack", tag: "path", attrs: { d: "M49 47 L41 38 L37 43 L41 53 L49 54 Z" } },
      { id: "lats", tag: "path", attrs: { d: "M37 46 Q32 58 40 73 L48 72 L48 62 Q44 58 41 55 Z" } },
      { id: "lowerBack", tag: "rect", center: true, attrs: { x: 43.5, y: 74, width: 13, height: 13, rx: 3 } },
      { id: "triceps", tag: "ellipse", attrs: { cx: 27, cy: 55, rx: 4.5, ry: 10 } },
      { id: "forearms", tag: "path", attrs: { d: "M23 66 L29 66 L25 88 L19 87 Z" } },
      { id: "glutes", tag: "ellipse", attrs: { cx: 43, cy: 96, rx: 7.5, ry: 8.5 } },
      { id: "hamstrings", tag: "path", attrs: { d: "M37 106 Q34 124 38 139 L47 139 Q50 122 49 106 Z" } },
      { id: "calves", tag: "ellipse", attrs: { cx: 42, cy: 164, rx: 5.5, ry: 14 } },
    ],
  },
};

const MIRROR = "matrix(-1 0 0 1 100 0)"; // reflect across the centre line

function BodyShape({ shape, fill }) {
  const Tag = shape.tag;
  const element = <Tag {...shape.attrs} fill={fill} />;
  if (shape.center) return element;
  return (
    <>
      {element}
      <g transform={MIRROR}>{element}</g>
    </>
  );
}

// One side of the figure. `fills` maps muscle id → colour; other muscles stay grey.
function BodyView({ side, fills }) {
  return (
    <>
      {BODY_VIEWS[side].body.map((shape, j) => (
        <BodyShape key={j} shape={shape} fill={MUSCLE_COLORS.body} />
      ))}
      {BODY_VIEWS[side].muscles.map((shape) => (
        <BodyShape key={shape.id} shape={shape} fill={fills[shape.id] ?? MUSCLE_COLORS.idle} />
      ))}
    </>
  );
}

// Front and back side by side.
function BodyFigure({ fills, height, label, showSides = false }) {
  return (
    <svg viewBox={`0 0 200 ${showSides ? 214 : 200}`} height={height} role="img" aria-label={label} className="shrink-0">
      {["front", "back"].map((side, i) => (
        <g key={side} transform={`translate(${i * 100} 0)`}>
          <BodyView side={side} fills={fills} />
          {showSides && (
            <text x="50" y="211" textAnchor="middle" fontSize="11" fill="#71717a">
              {side === "front" ? "Front" : "Back"}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function exerciseFills(muscles) {
  if (!muscles) return {};
  return {
    ...Object.fromEntries(muscles.secondary.map((m) => [m, MUSCLE_COLORS.secondary])),
    ...Object.fromEntries(muscles.primary.map((m) => [m, MUSCLE_COLORS.primary])),
  };
}

// Exercises the rules don't recognise are classified by the coach in batches, once, and remembered.
function useLearnedMuscles({ enabled, exerciseNames }) {
  const [learned, setLearned, learnedLoaded] = usePersistentState(STORAGE_KEYS.muscleMap, {});
  const requestedKey = useRef(null);
  const unknown = exerciseNames.filter((name) => !ruleMuscles(name) && !learned[name]).slice(0, MAX_EXERCISES_PER_CLASSIFICATION);
  const key = unknown.join("|");

  useEffect(() => {
    if (!enabled || !learnedLoaded || !unknown.length || requestedKey.current === key) return;
    requestedKey.current = key;
    askClaudeForJson(MUSCLE_CLASSIFIER_PROMPT, unknown.join("\n"))
      .then((result) => {
        const byName = Object.fromEntries(Object.entries(result).map(([name, muscles]) => [name.toLowerCase(), muscles]));
        const classified = unknown.filter((name) => byName[name.toLowerCase()]).map((name) => [name, sanitizeMuscles(byName[name.toLowerCase()])]);
        setLearned((current) => ({ ...current, ...Object.fromEntries(classified) }));
      })
      .catch(() => {}); // unclassified exercises just show a grey figure
  }, [enabled, learnedLoaded, key]);

  return learned;
}

function MuscleHeatmap({ workouts, learned }) {
  const sets = weeklyMuscleSets(workouts, learned);
  const fills = Object.fromEntries(MUSCLES.map((m) => [m, volumeColor(sets[m])]));
  const trained = MUSCLES.filter((m) => sets[m] > 0).sort((a, b) => sets[b] - sets[a]);
  const untrained = MUSCLES.filter((m) => sets[m] === 0);

  return (
    <Panel>
      <SectionTitle>Muscles, last 7 days</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-zinc-500">Sets per muscle. A set counts fully for the main muscle and half for helpers.</p>
      <div className="flex justify-center">
        <BodyFigure fills={fills} height={230} showSides label="Muscles trained in the last 7 days" />
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-3 text-xs text-zinc-500">
        {[...VOLUME_LEVELS].reverse().map((level) => (
          <span key={level.label} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: level.color }} />
            {level.label}
          </span>
        ))}
      </div>
      {trained.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {trained.map((m) => (
            <li key={m} className="flex justify-between">
              <span className="text-zinc-700">{MUSCLE_LABELS[m]}</span>
              <span className="tabular-nums text-zinc-500">{formatSets(sets[m])}</span>
            </li>
          ))}
        </ul>
      )}
      {untrained.length > 0 && (
        <p className="mt-3 text-sm text-zinc-500">Not trained: {joinWords(untrained.map((m) => MUSCLE_LABELS[m].toLowerCase()))}.</p>
      )}
    </Panel>
  );
}

/* ───────────────────────────── Video guides ───────────────────────────── */

const youtubeUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

// The library entry for an exercise, or null if the library doesn't cover it.
function guideFor(exercise) {
  const name = cleanExerciseName(exercise).toLowerCase();
  return VIDEO_LIBRARY.find((guide) => guide.match.test(name)) ?? null;
}

function VideoGuides({ guide }) {
  return (
    <div className="my-2 space-y-2 rounded-xl border border-zinc-200 bg-white p-3 text-sm">
      <div className="font-semibold text-zinc-900">Technique {guide.videos.length > 1 ? "videos" : "video"}: {guide.exercise}</div>
      <ul className="space-y-2">
        {guide.videos.map((video) => (
          <li key={video.id}>
            <a href={youtubeUrl(video.id)} target="_blank" rel="noopener noreferrer" className="flex gap-2">
              <PlayCircle className="mt-0.5 w-5 h-5 shrink-0 text-red-600" />
              <span>
                <span className="font-semibold text-blue-700">{guide.exercise} tutorial</span>
                <span className="block text-xs text-zinc-500">{video.channel} on YouTube</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────────────────────── Exercise thumbnails & details ───────────────────────────── */

// Where each muscle sits on the figure: which view shows it best, and a box (figure units, both sides)
// that thumbnails zoom into, so the target muscle fills a small tile.
const MUSCLE_FOCUS = {
  chest: { view: "front", box: [34, 33, 66, 52] },
  shoulders: { view: "front", box: [24, 30, 76, 46] },
  biceps: { view: "front", box: [22, 45, 78, 65] },
  forearms: { view: "front", box: [19, 66, 81, 88] },
  core: { view: "front", box: [41, 53, 59, 85] },
  quads: { view: "front", box: [34, 101, 66, 139] },
  traps: { view: "back", box: [37, 24, 63, 46] },
  upperBack: { view: "back", box: [37, 38, 63, 54] },
  lats: { view: "back", box: [32, 46, 68, 73] },
  lowerBack: { view: "back", box: [43, 74, 57, 87] },
  triceps: { view: "back", box: [22, 45, 78, 65] },
  glutes: { view: "back", box: [35, 87, 65, 105] },
  hamstrings: { view: "back", box: [34, 106, 66, 139] },
  calves: { view: "back", box: [36, 150, 64, 178] },
};
const THUMB_PADDING = 8; // figure units around the target muscles
const THUMB_MIN_SPAN = 48; // never zoom in so far that the body stops reading as a body

const EQUIPMENT_LABELS = {
  barbell: "Barbell", bigBarbell: "Barbell", dumbbell: "Dumbbells", kettlebell: "Kettlebell", cable: "Cable", machine: "Machine", bodyweight: "Bodyweight",
};

// The view and square crop that show an exercise's main muscles; the whole figure if they're unknown.
function thumbnailFrame(muscles) {
  const focus = (muscles?.primary ?? []).map((m) => MUSCLE_FOCUS[m]).filter(Boolean);
  if (!focus.length) return { view: "front", viewBox: "-50 0 200 200" };
  const view = focus[0].view;
  const boxes = focus.filter((f) => f.view === view).map((f) => f.box);
  const [x1, y1] = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1]))];
  const [x2, y2] = [Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
  const span = Math.max(x2 - x1, y2 - y1, THUMB_MIN_SPAN - 2 * THUMB_PADDING) + 2 * THUMB_PADDING;
  return { view, viewBox: `${(x1 + x2 - span) / 2} ${(y1 + y2 - span) / 2} ${span} ${span}` };
}

// Muscle lookups and the details sheet are needed in many places, so they're shared instead of passed down.
const ExerciseContext = createContext({ learnedMuscles: {}, showDetails: () => {} });

// Small tile zoomed in on the target muscles (red = main, light red = helpers). Tap for details.
function MuscleThumb({ name, size = 52, interactive = true }) {
  const { learnedMuscles, showDetails } = useContext(ExerciseContext);
  const muscles = musclesFor(name, learnedMuscles);
  const frame = thumbnailFrame(muscles);
  const tile = "relative shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-white";
  const picture = (
    <svg viewBox={frame.viewBox} width={size} height={size} aria-hidden="true">
      <BodyView side={frame.view} fills={exerciseFills(muscles)} />
    </svg>
  );
  if (!interactive) return <span className={tile} style={{ width: size, height: size }}>{picture}</span>;
  return (
    <button onClick={() => showDetails(name)} aria-label={`Show details for ${name}`} className={tile} style={{ width: size, height: size }}>
      {picture}
      <Info className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-white text-zinc-400" />
    </button>
  );
}

function ExerciseSheet({ name, onClose }) {
  const { learnedMuscles } = useContext(ExerciseContext);
  const muscles = musclesFor(name, learnedMuscles);
  const guide = guideFor(name);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose; // the parent re-renders often (e.g. the rest timer); this keeps the setup below to once

  // Keep the page behind still, start keyboard focus on Close, and let Escape close it.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event) => event.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const labels = (list) => {
    const text = joinWords(list.map((m) => MUSCLE_LABELS[m].toLowerCase()));
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.45)" }} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="exercise-sheet-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 pb-8"
        style={{ maxHeight: "88vh" }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="exercise-sheet-title" className="gb-display text-3xl font-bold leading-tight text-zinc-900">
            {name}
          </h2>
          <button ref={closeRef} onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-zinc-500">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="my-4 flex justify-center rounded-2xl bg-zinc-50 py-3">
          <BodyFigure
            fills={exerciseFills(muscles)}
            height={260}
            showSides
            label={muscles ? `Works ${describeMuscles(muscles).toLowerCase()}` : "Muscles not known yet"}
          />
        </div>

        <dl className="space-y-2 text-zinc-700">
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-semibold text-zinc-900">Main</dt>
            <dd className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: MUSCLE_COLORS.primary }} />
              {muscles?.primary.length ? labels(muscles.primary) : "Not known yet"}
            </dd>
          </div>
          {muscles?.secondary.length > 0 && (
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 font-semibold text-zinc-900">Helpers</dt>
              <dd className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: MUSCLE_COLORS.secondary }} />
                {labels(muscles.secondary)}
              </dd>
            </div>
          )}
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-semibold text-zinc-900">Equipment</dt>
            <dd>{EQUIPMENT_LABELS[equipmentOf(name)]}</dd>
          </div>
        </dl>

        {guide && <VideoGuides guide={guide} />}

        <div className="mt-4">
          <PrimaryButton onClick={onClose}>Done</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Check-in ───────────────────────────── */

function ChoiceRow({ label, options, value, onChange }) {
  return (
    <div role="radiogroup" aria-label={label}>
      <div className="mb-1 text-sm text-zinc-500">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            role="radio"
            aria-checked={value === option}
            onClick={() => onChange(option)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${value === option ? "border-blue-700 bg-blue-700 text-white" : "border-zinc-300 text-zinc-700"}`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

// The coach asks how the latest workout went. It stays until answered or skipped, even if the app is closed.
function CheckInCard({ workout, context, onSave }) {
  const [effort, setEffort] = useState(null);
  const [pain, setPain] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setBusy(true);
    setError("");
    const answer = `effort ${effort}; pain ${pain}${note.trim() ? `; note: ${note.trim()}` : ""}`;
    try {
      const reply = await askClaude(CHECK_IN_PROMPT, [
        { role: "user", content: `CHECK-IN for the ${workout.date} workout: ${answer}\nSESSION: ${formatWorkoutLine(workout)}\n\n${context}` },
      ]);
      onSave({ effort, pain, note: note.trim(), reply });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionTitle>How did it go?</SectionTitle>
          <p className="-mt-2 text-sm text-zinc-500">Your coach is checking in on your {formatShortDate(workout.date)} workout.</p>
        </div>
        <button onClick={() => onSave({ skipped: true })} className="shrink-0 pt-1 text-sm font-semibold text-zinc-500">
          Skip
        </button>
      </div>
      <ChoiceRow label="Effort" options={EFFORT_OPTIONS} value={effort} onChange={setEffort} />
      <ChoiceRow label="Any pain?" options={PAIN_OPTIONS} value={pain} onChange={setPain} />
      <Field label="Anything else? (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Slept badly, left knee felt tight" className={inputClass} />
      </Field>
      <PrimaryButton onClick={send} busy={busy} disabled={!effort || !pain}>
        Send to coach
      </PrimaryButton>
      <ErrorText message={error} />
    </Panel>
  );
}

function CoachReply({ text, onClose }) {
  return (
    <Panel className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <SectionTitle>From your coach</SectionTitle>
        <button onClick={onClose} aria-label="Close" className="text-zinc-400">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="text-zinc-700">
        <RichText text={text} />
      </div>
    </Panel>
  );
}

/* ───────────────────────────── Activities UI ───────────────────────────── */

function ActivityIcon({ type, size = 40 }) {
  const Icon = activityType(type).icon;
  return (
    <span role="img" aria-label={type} className="inline-flex shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700" style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.55)} />
    </span>
  );
}

const emptyActivityForm = () => ({ date: today(), minutes: "", distance: "", effort: null, notes: "" });

// Small until you pick an activity; then it opens just the fields that activity needs.
function ActivityPanel({ unit, onSave }) {
  const [type, setType] = useState(null);
  const [form, setForm] = useState(emptyActivityForm);
  const distanceUnit = type ? distanceUnitFor(type, unit) : null;
  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  function save() {
    const minutes = Math.round(Number(form.minutes));
    if (!type || !(minutes > 0)) return;
    const distance = distanceUnit ? Number(form.distance) || null : null;
    const activity = { id: newId(), type, minutes, distance, distanceUnit: distance ? distanceUnit : null, effort: form.effort };
    onSave(activityEntry(form.date, [activity], form.notes.trim()));
    setType(null);
    setForm(emptyActivityForm());
  }

  return (
    <Panel className="space-y-3">
      <div>
        <SectionTitle>Log an activity</SectionTitle>
        <p className="-mt-2 text-sm text-zinc-500">Running, swimming, yoga and more. Pick one to log it.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {ACTIVITY_TYPES.map(({ type: name, icon: Icon }) => (
          <button
            key={name}
            onClick={() => setType(type === name ? null : name)}
            aria-pressed={type === name}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${type === name ? "border-blue-700 bg-blue-700 text-white" : "border-zinc-300 text-zinc-700"}`}
          >
            <Icon size={16} />
            {name}
          </button>
        ))}
      </div>

      {type && (
        <div className="space-y-3 border-t border-zinc-200 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Minutes">
              <input type="number" inputMode="numeric" min="1" value={form.minutes} onChange={update("minutes")} className={inputClass} />
            </Field>
            {distanceUnit && (
              <Field label={`Distance (${distanceUnit})`}>
                <input type="number" inputMode="decimal" min="0" value={form.distance} onChange={update("distance")} placeholder="Optional" className={inputClass} />
              </Field>
            )}
            <Field label="Date" className={distanceUnit ? "col-span-2" : ""}>
              <input type="date" value={form.date} onChange={update("date")} className={inputClass} />
            </Field>
          </div>
          <ChoiceRow label="Effort (optional)" options={ACTIVITY_EFFORTS} value={form.effort} onChange={(effort) => setForm((f) => ({ ...f, effort }))} />
          <Field label="Notes (optional)">
            <input value={form.notes} onChange={update("notes")} placeholder="Intervals, felt light" className={inputClass} />
          </Field>
          <PrimaryButton onClick={save} disabled={!(Number(form.minutes) > 0)}>
            Save {type.toLowerCase()}
          </PrimaryButton>
        </div>
      )}
    </Panel>
  );
}

function ActivityWeek({ workouts }) {
  const summary = activitySummary(workouts);
  if (!summary.length) return null;
  return (
    <Panel>
      <SectionTitle>Activities, last 7 days</SectionTitle>
      <ul className="divide-y divide-zinc-200">
        {summary.map((s) => (
          <li key={s.type} className="flex items-center gap-3 py-2">
            <ActivityIcon type={s.type} size={36} />
            <span className="flex-1 font-medium text-zinc-900">{s.type}</span>
            <span className="text-right text-sm text-zinc-600 tabular-nums">{summaryText(s)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ───────────────────────────── Coach ───────────────────────────── */

function CoachView({ chat, setChat, context, briefing, onNavigate }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);

  const hasMounted = useRef(false);

  // Follow new messages, but open at the top so the Today card is the first thing you see.
  useEffect(() => {
    if (hasMounted.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    hasMounted.current = true;
  }, [chat.length, busy]);

  async function send(text) {
    const content = text.trim();
    if (!content || busy) return;
    const conversation = [...chat, { role: "user", content }];
    setChat(conversation);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const reply = await askClaude(`${COACH_PROMPT}\n\n${context}`, recentTurns(conversation, CHAT_CONTEXT_SIZE));
      setChat(recentTurns([...conversation, { role: "assistant", content: reply }], CHAT_HISTORY_SIZE));
    } catch (err) {
      setChat(chat); // roll back the unanswered question…
      setInput(content); // …so it can be sent again
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const clearButton = chat.length > 0 && (
    <button onClick={() => setChat([])} className="text-sm text-zinc-500">
      Clear chat
    </button>
  );

  return (
    <div>
      <ViewTitle action={clearButton}>Coach</ViewTitle>
      <TodayCard facts={briefing.facts} note={briefing.note} onNavigate={onNavigate} />
      {chat.length === 0 && (
        <p className="text-zinc-600 mb-4">Ask anything about your training. Your coach sees your goals, profile and recent workouts.</p>
      )}

      <div className="space-y-3 pb-36">
        {chat.map((message, i) =>
          message.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-xs rounded-2xl rounded-br-md bg-blue-700 text-white px-4 py-2.5">{message.content}</p>
            </div>
          ) : (
            <div key={i} className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-zinc-700">
              <RichText text={message.content} />
            </div>
          )
        )}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Thinking
          </div>
        )}
        <ErrorText message={error} />
        <div ref={bottomRef} />
      </div>

      <div className="fixed inset-x-0 bottom-16 bg-zinc-100 border-t border-zinc-200">
        <div className="max-w-md mx-auto px-4 pt-2 pb-3">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => send(prompt)}
                disabled={busy}
                className="shrink-0 rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 disabled:opacity-40"
              >
                {prompt}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(input)}
              placeholder="Message your coach"
              className={inputClass}
            />
            <button
              onClick={() => send(input)}
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="rounded-lg bg-blue-700 text-white px-3 disabled:opacity-40"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Log ───────────────────────────── */

/* ───────────────────────────── Live workout UI ───────────────────────────── */

function useNow(intervalMs) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(tick);
  }, [intervalMs]);
  return now;
}

function IconButton({ label, onClick, disabled = false, children }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} className="rounded-lg p-1.5 text-zinc-500 disabled:opacity-30">
      {children}
    </button>
  );
}

function StartWorkoutPanel({ planCount, lastWorkout, onStartPlan, onRepeatLast, onStartEmpty }) {
  const plural = (n) => `${n} ${n === 1 ? "exercise" : "exercises"}`;
  return (
    <Panel className="space-y-3">
      <SectionTitle>Start a workout</SectionTitle>
      <p className="-mt-1 text-sm text-zinc-500">
        Once started, you can edit sets, reorder and remove exercises, and check off sets as you go. Nothing is lost if you close the app.
      </p>
      {planCount > 0 && <PrimaryButton onClick={onStartPlan}>Start with Up next ({plural(planCount)})</PrimaryButton>}
      {lastWorkout && (
        <button onClick={onRepeatLast} className="w-full rounded-lg border border-blue-700 py-2.5 font-semibold text-blue-700">
          Repeat your {formatShortDate(lastWorkout.date)} workout ({plural(lastWorkout.exercises.length)})
        </button>
      )}
      <button onClick={onStartEmpty} className="w-full text-sm font-semibold text-zinc-500">
        Start an empty workout
      </button>
    </Panel>
  );
}

// On phones the keyboard and the bottom tab bar can cover a field low on the screen,
// so a tapped field is moved to the middle once the keyboard is up.
function keepFieldInView(event) {
  const field = event.target;
  setTimeout(() => field.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
}

// A compact list for changing the order. Rows are short, so the whole workout fits on screen
// and the exercise you just moved stays highlighted, instead of a tall card jumping away from your finger.
function ReorderList({ session, setSession, onDone }) {
  const [movedId, setMovedId] = useState(null);
  const count = session.exercises.length;
  const move = (exerciseId, offset) => {
    setSession((s) => moveExercise(s, exerciseId, offset));
    setMovedId(exerciseId);
  };
  const arrow = "flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-300 text-zinc-700 disabled:opacity-30";

  return (
    <div className="space-y-2">
      <p className="text-sm text-zinc-500">Use the arrows to change the order. The exercise you moved stays highlighted.</p>
      <ol className="divide-y divide-zinc-200 overflow-hidden rounded-xl border-2 border-zinc-200">
        {session.exercises.map((exercise, index) => (
          <li key={exercise.id} className={`flex items-center gap-2 px-3 py-2 ${exercise.id === movedId ? "bg-blue-50" : ""}`}>
            <span className="w-5 text-sm text-zinc-400 tabular-nums">{index + 1}</span>
            <MuscleThumb name={exercise.name} size={36} interactive={false} />
            <span className="min-w-0 flex-1 font-medium text-zinc-900">{exercise.name}</span>
            <button onClick={() => move(exercise.id, -1)} disabled={index === 0} aria-label={`Move ${exercise.name} up`} className={arrow}>
              <ChevronUp className="w-5 h-5" />
            </button>
            <button onClick={() => move(exercise.id, 1)} disabled={index === count - 1} aria-label={`Move ${exercise.name} down`} className={arrow}>
              <ChevronDown className="w-5 h-5" />
            </button>
          </li>
        ))}
      </ol>
      <PrimaryButton onClick={onDone}>Done</PrimaryButton>
    </div>
  );
}

// One set: editable weight and reps, plus an action on the right (✓ while training, remove while editing).
function SetRow({ set, number, unit, onEdit, children }) {
  const numberInput = "rounded-lg border border-zinc-300 bg-white px-2 py-2 text-center text-base tabular-nums";
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-5 text-sm text-zinc-400 tabular-nums">{number}</span>
      <input
        type="number"
        inputMode="decimal"
        value={set.weight}
        onChange={(e) => onEdit("weight", e.target.value)}
        onFocus={keepFieldInView}
        aria-label={`Set ${number} weight`}
        className={`w-20 ${numberInput}`}
      />
      <span className="text-sm text-zinc-500">{unit} ×</span>
      <input
        type="number"
        inputMode="numeric"
        value={set.reps}
        onChange={(e) => onEdit("reps", e.target.value)}
        onFocus={keepFieldInView}
        aria-label={`Set ${number} reps`}
        className={`w-16 ${numberInput}`}
      />
      <span className="flex-1" />
      {children}
    </div>
  );
}

// An exercise in a workout. `live`: check sets off as you train. `edit`: fix a saved workout.
function ExerciseCard({ exercise, unit, mode, isCurrent = false, update, onSetDone }) {
  const [showVideo, setShowVideo] = useState(false);
  const guide = guideFor(exercise.name);
  const id = exercise.id;
  const live = mode === "live";
  const lastSet = exercise.sets.at(-1);
  const allDone = exercise.sets.every((set) => set.done);

  function toggle(set) {
    update((s) => toggleSet(s, id, set.id));
    if (!set.done) onSetDone(exercise);
  }

  return (
    <li className={`rounded-xl border-2 p-3 ${isCurrent ? "border-blue-700" : "border-zinc-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <MuscleThumb name={exercise.name} size={52} />
          <div className="min-w-0">
            {isCurrent && <div className="text-xs font-semibold text-blue-700">Now</div>}
            <div className={`font-semibold ${live && allDone ? "text-zinc-400" : "text-zinc-900"}`}>{exercise.name}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          {guide && (
            <IconButton label={`${showVideo ? "Hide" : "Show"} technique video for ${exercise.name}`} onClick={() => setShowVideo((open) => !open)}>
              <PlayCircle className="w-5 h-5" />
            </IconButton>
          )}
          <IconButton label={`Remove ${exercise.name}`} onClick={() => update((s) => removeExercise(s, id))}>
            <X className="w-5 h-5" />
          </IconButton>
        </div>
      </div>
      {showVideo && guide && <VideoGuides guide={guide} />}

      <div className="mt-1">
        {exercise.sets.map((set, i) => (
          <SetRow key={set.id} set={set} number={i + 1} unit={unit} onEdit={(field, value) => update((s) => editSet(s, id, set.id, field, value))}>
            {live ? (
              <button
                onClick={() => toggle(set)}
                aria-pressed={set.done}
                aria-label={`Set ${i + 1} done`}
                className={`flex h-11 w-11 items-center justify-center rounded-full ${set.done ? "bg-green-600 text-white" : "border-2 border-zinc-300 text-zinc-300"}`}
              >
                <Check className="w-5 h-5" />
              </button>
            ) : (
              <IconButton label={`Remove set ${i + 1}`} onClick={() => update((s) => removeSet(s, id, set.id))}>
                <Trash2 className="w-4 h-4" />
              </IconButton>
            )}
          </SetRow>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
        <button onClick={() => update((s) => addSet(s, id))} className="text-blue-700">
          Add set
        </button>
        {live && lastSet && exercise.sets.length > 1 && (
          <button onClick={() => update((s) => removeSet(s, id, lastSet.id))} className="text-zinc-500">
            Remove last set
          </button>
        )}
        {live && !allDone && (
          <button onClick={() => update((s) => completeExercise(s, id))} className="text-zinc-500">
            Mark all done
          </button>
        )}
      </div>
    </li>
  );
}

function ExerciseList({ session, setSession, unit, mode, onSetDone }) {
  const [reordering, setReordering] = useState(false);
  const currentId = mode === "live" ? currentExerciseId(session) : null;
  if (reordering) return <ReorderList session={session} setSession={setSession} onDone={() => setReordering(false)} />;

  return (
    <div className="space-y-3">
      {session.exercises.length > 1 && (
        <button
          onClick={() => setReordering(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-semibold text-zinc-700"
        >
          <ArrowUpDown className="w-4 h-4" />
          Reorder exercises
        </button>
      )}
      <ol className="space-y-3">
        {session.exercises.map((exercise) => (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            unit={unit}
            mode={mode}
            isCurrent={exercise.id === currentId}
            update={setSession}
            onSetDone={onSetDone}
          />
        ))}
      </ol>
    </div>
  );
}

function SessionDetails({ session, setSession }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Date">
        <input type="date" value={session.date} onChange={(e) => setSession((s) => ({ ...s, date: e.target.value }))} className={inputClass} />
      </Field>
      <Field label="Notes (optional)">
        <input value={session.notes} onChange={(e) => setSession((s) => ({ ...s, notes: e.target.value }))} placeholder="Felt strong" className={inputClass} />
      </Field>
    </div>
  );
}

function WorkoutPanel({ session, setSession, unit, onFinish, onStartRest }) {
  const [discardArmed, armDiscard] = useArmed();
  const now = useNow(30_000);
  const { done, total } = sessionSetCounts(session);
  const minutes = Math.max(0, Math.floor((now - session.startedAt) / 60_000));

  // Rest after every set except the very last one of the workout.
  const onSetDone = (exercise) => {
    if (total - done > 1) onStartRest(exercise.rest, exercise.name);
  };

  return (
    <Panel className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle>Workout</SectionTitle>
        <span className="text-sm text-zinc-500 tabular-nums">
          {minutes} min, {done} of {total} sets
        </span>
      </div>
      {session.exercises.length === 0 && <p className="-mt-1 text-sm text-zinc-500">Add exercises from Up next or the form below.</p>}
      <ExerciseList session={session} setSession={setSession} unit={unit} mode="live" onSetDone={onSetDone} />
      <SessionDetails session={session} setSession={setSession} />
      <PrimaryButton onClick={onFinish} disabled={done === 0}>
        Finish and save {done} {done === 1 ? "set" : "sets"}
      </PrimaryButton>
      <button
        onClick={discardArmed ? () => setSession(null) : armDiscard}
        className={`w-full text-sm font-semibold ${discardArmed ? "text-red-600" : "text-zinc-500"}`}
      >
        {discardArmed ? "Tap again to discard this workout" : "Discard workout"}
      </button>
    </Panel>
  );
}

// Fix a saved workout with the same cards used while training: edit sets, add or remove them, reorder exercises.
function WorkoutEditor({ workout, unit, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => workoutToSession(workout));
  const setCount = draft.exercises.reduce((sum, e) => sum + e.sets.length, 0);

  return (
    <div className="mt-2 space-y-3">
      <ExerciseList session={draft} setSession={setDraft} unit={unit} mode="edit" />
      <SessionDetails session={draft} setSession={setDraft} />
      <PrimaryButton onClick={() => onSave({ ...workout, ...sessionToWorkout(draft, { allSets: true }), id: workout.id })} disabled={setCount === 0}>
        Save changes
      </PrimaryButton>
      <button onClick={onCancel} className="w-full text-sm font-semibold text-zinc-500">
        Cancel
      </button>
    </div>
  );
}

function LogView({ workouts, setWorkouts, session, setSession, settings, plans, learnedMuscles, coachContext, onRangeChange, onStartRest, unit }) {
  const [description, setDescription] = useState("");
  const [manual, setManual] = useState({ name: "", sets: "3", reps: "8", weight: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [highlights, setHighlights] = useState(null);
  const [coachReply, setCoachReply] = useState(null);
  const checkInWorkout = pendingCheckIn(workouts);

  function saveCheckIn(checkIn) {
    setWorkouts((all) => all.map((w) => (w.id === checkInWorkout.id ? { ...w, checkIn } : w)));
    if (checkIn.reply) setCoachReply(checkIn.reply);
  }

  // Adding anything starts a workout if none is in progress.
  const addToSession = (...exercises) => setSession((current) => addExercises(current ?? startSession(), exercises));

  // Saves a finished entry (a workout or an activity) and shows what to celebrate.
  function saveEntry(entry) {
    setHighlights(sessionHighlights(entry, workouts, settings));
    setWorkouts((all) => [...all, entry]);
    window.scrollTo({ top: 0, behavior: "smooth" }); // the highlights appear at the top
  }

  async function addFromDescription() {
    setBusy(true);
    setError("");
    try {
      const parsed = await askClaudeForJson(LOG_PARSER_PROMPT, description);
      const exercises = sanitizeExercises(parsed);
      const activities = sanitizeActivities(parsed);
      if (!exercises.length && !activities.length) throw new Error("Nothing to log found. Try “squat 3x5 at 100” or “ran 5 km in 28 minutes”.");
      if (exercises.length) addToSession(...exercises.map((e) => sessionExercise(e.name, e.sets, { done: true }))); // described = already lifted
      if (activities.length) saveEntry(activityEntry(today(), activities)); // activities are done, so they're saved right away
      setDescription("");
    } catch (err) {
      setError(err instanceof SyntaxError ? "Couldn't read that description. Try rephrasing it." : err.message);
    } finally {
      setBusy(false);
    }
  }

  function addManual() {
    const name = normalizeName(manual.name);
    const sets = Number(manual.sets);
    const reps = Number(manual.reps);
    const weight = Number(manual.weight) || 0;
    if (!name || sets < 1 || reps < 1) return;
    addToSession(sessionExercise(name, repeatSet(sets, { reps, weight })));
    setManual((m) => ({ ...m, name: "", weight: "" }));
  }

  function finishWorkout() {
    saveEntry(sessionToWorkout(session));
    setSession(null);
  }

  const updateManual = (field) => (e) => setManual((m) => ({ ...m, [field]: e.target.value }));

  return (
    <div className="space-y-4">
      <ViewTitle
        action={
          <button onClick={() => setShowImport((open) => !open)} className="text-sm font-semibold text-blue-700">
            {showImport ? "Close import" : "Import history"}
          </button>
        }
      >
        Log workout
      </ViewTitle>

      {highlights && <SessionHighlights facts={highlights} onClose={() => setHighlights(null)} />}
      {checkInWorkout && !session && <CheckInCard key={checkInWorkout.id} workout={checkInWorkout} context={coachContext} onSave={saveCheckIn} />}
      {coachReply && <CoachReply text={coachReply} onClose={() => setCoachReply(null)} />}

      {showImport && <ImportPanel workouts={workouts} setWorkouts={setWorkouts} unit={unit} />}

      {session ? (
        <WorkoutPanel session={session} setSession={setSession} unit={unit} onFinish={finishWorkout} onStartRest={onStartRest} />
      ) : (
        <StartWorkoutPanel
          planCount={plans.length}
          lastWorkout={lastGymWorkout(workouts)}
          onStartPlan={() => setSession(planSession(plans))}
          onRepeatLast={() => setSession(repeatLastWorkout(workouts, plans))}
          onStartEmpty={() => setSession(startSession())}
        />
      )}

      <ActivityPanel unit={unit} onSave={saveEntry} />

      <AutopilotPanel
        plans={plans}
        learnedMuscles={learnedMuscles}
        unit={unit}
        inWorkout={Boolean(session)}
        addedNames={session?.exercises.map((e) => e.name) ?? []}
        onAdd={(plan) => addToSession(planExercise(plan))}
        onAddAll={(list) => addToSession(...list.map(planExercise))}
        onRangeChange={onRangeChange}
        onStartRest={onStartRest}
      />

      <Panel className="space-y-4">
        <SectionTitle>Add exercises</SectionTitle>
        <div className="space-y-2">
          <Field label="Describe what you did">
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Squat 3x5 at 100, bench 80 for 8, 8, 7, then a 5 km run in 28 min"
              className={inputClass}
            />
          </Field>
          <button
            onClick={addFromDescription}
            disabled={busy || !description.trim()}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-blue-700 text-blue-700 font-semibold py-2.5 disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Add from description
          </button>
          <ErrorText message={error} />
        </div>

        <div className="space-y-2 pt-2 border-t border-zinc-200">
          <Field label="Or add one exercise">
            <input list="exercise-names" value={manual.name} onChange={updateManual("name")} placeholder="Exercise" className={inputClass} />
          </Field>
          <div className="grid grid-cols-4 gap-2 items-end">
            <Field label="Sets">
              <input type="number" inputMode="numeric" min="1" value={manual.sets} onChange={updateManual("sets")} className={inputClass} />
            </Field>
            <Field label="Reps">
              <input type="number" inputMode="numeric" min="1" value={manual.reps} onChange={updateManual("reps")} className={inputClass} />
            </Field>
            <Field label={unit}>
              <input type="number" inputMode="decimal" min="0" value={manual.weight} onChange={updateManual("weight")} placeholder="BW" className={inputClass} />
            </Field>
            <button
              onClick={addManual}
              disabled={!manual.name.trim()}
              aria-label="Add exercise"
              className="h-11 rounded-lg bg-zinc-900 text-white flex items-center justify-center disabled:opacity-40"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>
      </Panel>

      <WorkoutHistory
        workouts={workouts}
        unit={unit}
        onUpdate={(updated) => setWorkouts((all) => all.map((w) => (w.id === updated.id ? updated : w)))}
        onDelete={(id) => setWorkouts((all) => all.filter((w) => w.id !== id))}
      />
    </div>
  );
}

const AUTOPILOT_PREVIEW_COUNT = 5;

// Up next shows only exercises that aren't in the workout yet, so it's clear what you're doing today.
function AutopilotPanel({ plans, learnedMuscles, unit, inWorkout, addedNames, onAdd, onAddAll, onRangeChange, onStartRest }) {
  const [showAll, setShowAll] = useState(false);
  const remaining = plans.filter((plan) => !addedNames.includes(plan.name));
  if (!remaining.length) return null;
  const visible = showAll ? remaining : remaining.slice(0, AUTOPILOT_PREVIEW_COUNT);

  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <SectionTitle>Up next</SectionTitle>
        {inWorkout && remaining.length > 1 && (
          <button onClick={() => onAddAll(remaining)} className="shrink-0 pt-1 text-sm font-semibold text-blue-700">
            Add all {remaining.length}
          </button>
        )}
      </div>
      <p className="-mt-1 text-sm text-zinc-500">
        {inWorkout
          ? "Not in this workout yet. Tap Add to bring an exercise in, then edit or reorder it above."
          : "Hit the top of the rep range on every set and the weight goes up next time. Ranges follow how you've been training; change one on its row."}
      </p>
      <ul className="divide-y divide-zinc-200">
        {visible.map((plan) => (
          <PlanRow
            key={plan.name}
            plan={plan}
            muscles={musclesFor(plan.name, learnedMuscles)}
            unit={unit}
            onAdd={() => onAdd(plan)}
            onRangeChange={(range) => onRangeChange(plan.name, range)}
            onRest={() => onStartRest(plan.rest, plan.name)}
          />
        ))}
      </ul>
      {remaining.length > AUTOPILOT_PREVIEW_COUNT && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-1 text-sm font-semibold text-blue-700">
          {showAll ? "Show fewer" : `Show all ${remaining.length} exercises`}
        </button>
      )}
    </Panel>
  );
}

function PlanRow({ plan, muscles, unit, onAdd, onRangeChange, onRest }) {
  const [showVideos, setShowVideos] = useState(false);
  const guide = guideFor(plan.name);
  const { label, className } = PLAN_STATUS[plan.status];
  const { sets, reps, weight } = plan.target;
  const load = (w) => (w ? `${w} ${unit}` : "BW");

  return (
    <li className="py-3 flex gap-3">
      <MuscleThumb name={plan.name} size={64} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-zinc-900">{plan.name}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>{label}</span>
        </div>
        <div className="gb-display text-2xl font-bold text-zinc-900 leading-tight tabular-nums">
          {sets}×{reps} @ {load(weight)}
        </div>
        {muscles && <p className="text-sm font-medium text-red-700">{describeMuscles(muscles)}</p>}
        <p className="text-sm text-zinc-500">
          Last: {load(plan.last.weight)} × {plan.last.reps.join(", ")} on {formatShortDate(plan.last.date)}. {plan.reason}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={onRest}
            aria-label={`Start a ${formatClock(plan.rest)} rest for ${plan.name}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-semibold text-zinc-700"
          >
            <Timer className="w-4 h-4" />
            Rest {formatClock(plan.rest)}
          </button>
          <button
            onClick={onAdd}
            aria-label={`Add ${plan.name} to your workout`}
            className="inline-flex items-center gap-1 rounded-full border border-blue-700 px-3 py-1 text-sm font-semibold text-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
          <select
            value={formatRange(plan.range)}
            onChange={(e) => onRangeChange(REP_RANGES.find((r) => formatRange(r) === e.target.value))}
            aria-label={`Rep range for ${plan.name}`}
            className="bg-transparent text-sm text-zinc-600"
          >
            {REP_RANGES.map((range) => (
              <option key={formatRange(range)} value={formatRange(range)}>
                {formatRange(range)} reps
              </option>
            ))}
          </select>
          {guide && (
            <button
              onClick={() => setShowVideos((open) => !open)}
              aria-expanded={showVideos}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-semibold text-zinc-700"
            >
              <PlayCircle className="w-4 h-4" />
              {showVideos ? "Hide video" : "Video"}
            </button>
          )}
        </div>
        {showVideos && guide && <VideoGuides guide={guide} />}
      </div>
    </li>
  );
}

const HISTORY_LIMIT = 20;

// Folded by default: one line with the count. Open it for one compact row per workout,
// and tap a row for its sets, Edit and Delete.
function WorkoutHistory({ workouts, unit, onUpdate, onDelete }) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  if (!workouts.length) return null;

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const Chevron = ({ up }) => (up ? <ChevronUp className="w-5 h-5 shrink-0" /> : <ChevronDown className="w-5 h-5 shrink-0" />);

  return (
    <Panel>
      <h2 className="gb-display text-2xl font-bold text-zinc-900">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-3">
          History
          <span className="flex items-center gap-1 text-base font-semibold text-zinc-500">
            {plural(workouts.length, "workout")}
            <Chevron up={open} />
          </span>
        </button>
      </h2>

      {open && (
        <ul className="mt-2 divide-y divide-zinc-200">
          {sortNewestFirst(workouts)
            .slice(0, HISTORY_LIMIT)
            .map((workout) => {
              const editing = editingId === workout.id;
              const expanded = editing || expandedId === workout.id;
              return (
                <li key={workout.id} className="py-2">
                  <button
                    onClick={() => setExpandedId(expanded ? null : workout.id)}
                    aria-expanded={expanded}
                    className="flex w-full items-center justify-between gap-3 py-1 text-left"
                  >
                    <span>
                      <span className="font-semibold text-zinc-900">{formatDate(workout.date)}</span>
                      <span className="block text-sm text-zinc-500 tabular-nums">
                        {[
                          workout.exercises.length > 0 && `${plural(workout.exercises.length, "exercise")}, ${formatVolume(workoutVolume(workout))} ${unit}`,
                          ...(workout.activities ?? []).map(activityLabel),
                        ]
                          .filter(Boolean)
                          .join(" + ")}
                      </span>
                    </span>
                    <span className="text-zinc-400">
                      <Chevron up={expanded} />
                    </span>
                  </button>

                  {editing && (
                    <WorkoutEditor
                      workout={workout}
                      unit={unit}
                      onSave={(updated) => {
                        onUpdate(updated);
                        setEditingId(null);
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  )}

                  {expanded && !editing && (
                    <div className="pb-1">
                      <ul className="mt-1 space-y-1.5 text-sm text-zinc-600">
                        {(workout.activities ?? []).map((activity) => (
                          <li key={activity.id} className="flex items-center gap-2">
                            <ActivityIcon type={activity.type} size={32} />
                            <span>
                              {activityLabel(activity)}{" "}
                              <span className="text-zinc-400">{[paceText(activity), activity.effort?.toLowerCase()].filter(Boolean).join(", ")}</span>
                            </span>
                          </li>
                        ))}
                        {workout.exercises.map((exercise, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <MuscleThumb name={exercise.name} size={32} />
                            <span>
                              {exercise.name} <span className="text-zinc-400">{describeSets(exercise.sets, unit)}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                      {workout.notes && <p className="mt-1 text-sm italic text-zinc-500">{workout.notes}</p>}
                      {workout.checkIn && !workout.checkIn.skipped && (
                        <p className="mt-1 text-sm text-zinc-500">
                          Felt {workout.checkIn.effort.toLowerCase()}, pain: {workout.checkIn.pain.toLowerCase()}
                          {workout.checkIn.note ? ` (${workout.checkIn.note})` : ""}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-5">
                        {workout.exercises.length > 0 && (
                          <button onClick={() => setEditingId(workout.id)} className="text-sm font-semibold text-blue-700">
                            Edit
                          </button>
                        )}
                        <DeleteButton label="Delete workout" onConfirm={() => onDelete(workout.id)} />
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
        </ul>
      )}
      {open && workouts.length > HISTORY_LIMIT && <p className="mt-2 text-xs text-zinc-500">Showing your {HISTORY_LIMIT} most recent workouts.</p>}
    </Panel>
  );
}

/* ───────────────────────────── Import history ───────────────────────────── */

function ImportPanel({ workouts, setWorkouts, unit }) {
  const [preview, setPreview] = useState(null); // { workouts, duplicates, skipped }
  const [importedCount, setImportedCount] = useState(0);
  const [pastedCsv, setPastedCsv] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");

  // Shared by both entry points: `read` returns { workouts, skipped }.
  async function loadPreview(read) {
    setReading(true);
    setError("");
    setPreview(null);
    setImportedCount(0);
    try {
      const { workouts: found, skipped } = await read();
      if (!found.length) throw new Error("No sets with reps found. Check that this is a workout export.");
      const fresh = withoutDuplicates(found, workouts);
      setPreview({ workouts: sortOldestFirst(fresh), duplicates: found.length - fresh.length, skipped });
    } catch (err) {
      setError(err instanceof SyntaxError ? "Couldn't read a workout from that. Try a sharper screenshot or one workout per screenshot." : err.message);
    } finally {
      setReading(false);
    }
  }

  const importFiles = (files) => loadPreview(() => readImportFiles(files, unit));
  const importPasted = () => loadPreview(() => workoutsFromCsv(pastedCsv, unit));

  function confirmImport() {
    setWorkouts((all) => [...all, ...preview.workouts.map((w) => ({ ...w, id: crypto.randomUUID() }))]);
    setImportedCount(preview.workouts.length);
    setPreview(null);
    setPastedCsv("");
  }

  return (
    <Panel className="space-y-3">
      <div>
        <SectionTitle>Import history</SectionTitle>
        <p className="-mt-1 text-sm text-zinc-500">
          Export a CSV from Strong, Hevy or most other lifting apps and choose it here. No export option? Upload screenshots of your history instead.
        </p>
      </div>

      <FilePicker busy={reading} title={reading ? "Reading your history" : "Choose a CSV or screenshots"} onFiles={importFiles} />

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-blue-700">Can't pick a file? Paste the CSV text instead</summary>
        <div className="mt-2 space-y-2">
          <textarea
            rows={5}
            value={pastedCsv}
            onChange={(e) => setPastedCsv(e.target.value)}
            placeholder="Date,Workout Name,Exercise Name,Set Order,Weight,Reps…"
            className={inputClass}
          />
          <PrimaryButton onClick={importPasted} busy={reading} disabled={!pastedCsv.trim()}>
            Read pasted CSV
          </PrimaryButton>
        </div>
      </details>

      <ErrorText message={error} />
      {preview && <ImportPreview preview={preview} onConfirm={confirmImport} />}
      {importedCount > 0 && (
        <p className="text-sm font-semibold text-green-700">Imported {importedCount} workouts. Your charts and targets now include them.</p>
      )}
      <p className="text-xs text-zinc-500">
        CSV files are read on your phone. Screenshots, and the first 5 rows of a CSV layout GymBot doesn't recognise, are sent to the coach to read.
      </p>
    </Panel>
  );
}

function ImportPreview({ preview, onConfirm }) {
  const { workouts, duplicates, skipped } = preview;
  const names = exercisesByFrequency(workouts);
  const shownNames = 8;

  return (
    <div className="space-y-2 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-700">
      {workouts.length > 0 ? (
        <p>
          <span className="font-semibold text-zinc-900">{workouts.length} new workouts</span> from {formatLongDate(workouts[0].date)} to{" "}
          {formatLongDate(workouts.at(-1).date)}.
        </p>
      ) : (
        <p className="font-semibold text-zinc-900">Everything in this file is already in your log.</p>
      )}
      {duplicates > 0 && <p>{duplicates} workouts already in your log will be skipped.</p>}
      {skipped > 0 && <p>{skipped} rows skipped: warm-up sets, cardio or unreadable rows.</p>}
      {names.length > 0 && (
        <p>
          Exercises: {names.slice(0, shownNames).join(", ")}
          {names.length > shownNames ? ` and ${names.length - shownNames} more` : ""}.
        </p>
      )}
      {workouts.length > 0 && <PrimaryButton onClick={onConfirm}>Import {workouts.length} workouts</PrimaryButton>}
    </div>
  );
}

/* ───────────────────────────── Form check ───────────────────────────── */

function FormCheckView({ profileNotes, formChecks, setFormChecks }) {
  const [exercise, setExercise] = useState("");
  const [focus, setFocus] = useState("");
  const [media, setMedia] = useState(null); // { kind: "video" | "photos", frames: base64[] }
  const [feedback, setFeedback] = useState("");
  const [status, setStatus] = useState("idle"); // idle | reading | analyzing
  const [error, setError] = useState("");

  async function handleFiles(files) {
    setStatus("reading");
    setError("");
    setFeedback("");
    setMedia(null);
    try {
      setMedia(await filesToMedia(files));
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus("idle");
    }
  }

  async function analyze() {
    setStatus("analyzing");
    setError("");
    const request = [
      `Exercise: ${exercise.trim() || "not specified, identify it"}.`,
      media.kind === "video" && `These ${media.frames.length} frames are sampled evenly from one set, in order.`,
      focus.trim() && `The athlete wants you to look at: ${focus.trim()}`,
      profileNotes && `Athlete background: ${profileNotes}`,
    ]
      .filter(Boolean)
      .join("\n");
    const content = [
      ...media.frames.map(imageBlock),
      { type: "text", text: request },
    ];
    try {
      const result = await askClaude(FORM_PROMPT, [{ role: "user", content }]);
      setFeedback(result);
      const check = { id: crypto.randomUUID(), date: today(), exercise: normalizeName(exercise) || "Unnamed lift", feedback: result };
      setFormChecks((all) => [check, ...all].slice(0, 30));
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus("idle");
    }
  }

  return (
    <div className="space-y-4">
      <ViewTitle>Form check</ViewTitle>

      <Panel className="space-y-4">
        <Field label="Exercise">
          <input list="exercise-names" value={exercise} onChange={(e) => setExercise(e.target.value)} placeholder="Back Squat" className={inputClass} />
        </Field>
        <Field label="Anything to focus on? (optional)">
          <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Knees cave on the way up" className={inputClass} />
        </Field>

        <FilePicker
          accept="video/*,image/*"
          busy={status === "reading"}
          title={media ? "Choose a different file" : "Upload a video or photos"}
          hint={`Film from the side with your whole body in frame. Videos stay on your phone; only ${FRAME_COUNT} still frames are sent.`}
          onFiles={handleFiles}
        />

        {media && (
          <div className="grid grid-cols-3 gap-2">
            {media.frames.map((frame, i) => (
              <img key={i} src={`data:image/jpeg;base64,${frame}`} alt={`Frame ${i + 1}`} className="w-full h-28 object-cover rounded-lg" />
            ))}
          </div>
        )}

        <PrimaryButton onClick={analyze} busy={status === "analyzing"} disabled={!media || status !== "idle"}>
          Check my form
        </PrimaryButton>
        <ErrorText message={error} />
      </Panel>

      {feedback && (
        <Panel className="text-zinc-700">
          <RichText text={feedback} />
        </Panel>
      )}
      {feedback && exercise.trim() && guideFor(exercise) && <VideoGuides guide={guideFor(exercise)} />}

      {formChecks.length > 0 && (
        <Panel>
          <SectionTitle>Past checks</SectionTitle>
          <div className="divide-y divide-zinc-200">
            {formChecks.map((check) => (
              <details key={check.id} className="py-3">
                <summary className="flex justify-between cursor-pointer list-none">
                  <span className="font-semibold text-zinc-900">{check.exercise}</span>
                  <span className="text-sm text-zinc-500">{formatDate(check.date)}</span>
                </summary>
                <div className="mt-2 text-sm text-zinc-700">
                  <RichText text={check.feedback} />
                </div>
              </details>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ───────────────────────────── Progress ───────────────────────────── */

function Stat({ value, label }) {
  return (
    <div className="rounded-2xl bg-white p-3">
      <div className="gb-display text-3xl font-bold text-zinc-900 leading-none tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{label}</div>
    </div>
  );
}

// One line under the 1RM chart: where this lift is heading if the recent pace holds.
function TrendLine({ workouts, exercise, unit }) {
  const trend = strengthTrend(workouts, exercise);
  let text = "Log this lift over 2+ weeks to see where it's heading.";
  if (trend && trend.perDay * 7 >= FORECAST_MIN_WEEKLY_GAIN) {
    text = `At this pace: about ${round1(trend.todayValue + trend.perDay * 28)} ${unit} in 4 weeks (+${round1(trend.perDay * 7)} ${unit} a week).`;
  } else if (trend) {
    text = "Flat over the last few weeks. Ask your coach how to get it moving.";
  }
  return <p className="mt-2 text-sm text-zinc-600">{text}</p>;
}

function ProgressView({ workouts, records, exerciseNames, learnedMuscles, unit, daysPerWeek, onNavigate }) {
  const [selected, setSelected] = useState(exerciseNames[0] ?? "");
  const trend = useMemo(() => exerciseTrend(workouts, selected), [workouts, selected]);
  const volume = useMemo(() => weeklyVolume(workouts), [workouts]);

  if (!workouts.length) {
    return (
      <div>
        <ViewTitle>Progress</ViewTitle>
        <Panel className="space-y-3">
          <p className="text-zinc-600">Your charts appear here once you log a workout.</p>
          <PrimaryButton onClick={() => onNavigate("log")}>Log a workout</PrimaryButton>
        </Panel>
      </div>
    );
  }

  const thisWeek = workouts.filter((w) => weekStart(w.date) === weekStart(today()));
  const thisWeekVolume = thisWeek.reduce((sum, w) => sum + workoutVolume(w), 0);
  const bestLifts = Object.entries(records).sort(([, a], [, b]) => b.e1rm - a.e1rm);

  return (
    <div className="space-y-4">
      <ViewTitle>Progress</ViewTitle>

      <div className="grid grid-cols-3 gap-2">
        <Stat value={workouts.length} label="sessions logged" />
        <Stat value={`${sessionsInWeekOf(workouts, today())}/${daysPerWeek}`} label="training days this week" />
        <Stat value={formatVolume(thisWeekVolume)} label={`${unit} lifted this week`} />
      </div>

      <ActivityWeek workouts={workouts} />
      <MuscleHeatmap workouts={workouts} learned={learnedMuscles} />

      {exerciseNames.length > 0 && (
      <Panel>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="gb-display text-2xl font-bold text-zinc-900">Estimated 1RM</h2>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-40 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm">
            {exerciseNames.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="date" tick={CHART.tick} tickLine={false} axisLine={false} />
            <YAxis tick={CHART.tick} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
            <Tooltip contentStyle={CHART.tooltip} />
            <Line type="monotone" dataKey="e1rm" name={`Est. 1RM (${unit})`} stroke={CHART.accent} strokeWidth={2.5} dot={{ r: 3, fill: CHART.accent }} />
          </LineChart>
        </ResponsiveContainer>
        <TrendLine workouts={workouts} exercise={selected} unit={unit} />
      </Panel>
      )}

      <Panel>
        <SectionTitle>Weekly volume</SectionTitle>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={volume} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="week" tick={CHART.tick} tickLine={false} axisLine={false} interval={1} />
            <YAxis tick={CHART.tick} tickLine={false} axisLine={false} tickFormatter={formatVolume} />
            <Tooltip contentStyle={CHART.tooltip} formatter={(v) => [`${v} ${unit}`, "Volume"]} />
            <Bar dataKey="volume" fill={CHART.accent} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      {bestLifts.length > 0 && (
      <Panel>
        <SectionTitle>Best lifts</SectionTitle>
        <ul className="divide-y divide-zinc-200">
          {bestLifts.map(([name, record]) => (
            <li key={name} className="flex items-center justify-between gap-3 py-2">
              <span className="text-zinc-800">{name}</span>
              <span className="text-right">
                <span className="font-semibold text-zinc-900 tabular-nums">{record.e1rm ? `${record.e1rm} ${unit}` : `${record.set.reps} reps`}</span>
                <span className="block text-xs text-zinc-500">
                  {record.set.weight || "BW"}×{record.set.reps} on {formatShortDate(record.date)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      )}
    </div>
  );
}

/* ───────────────────────────── Goals ───────────────────────────── */

// The target loaded on a barbell: plates you've already lifted are solid, the rest are outlines.
function LoadedBar({ target, current, unit }) {
  let loaded = PLATES[unit].bar;
  const plates = platesPerSide(target, unit).map((plate) => {
    loaded += plate.weight * 2;
    return { ...plate, lifted: loaded <= current + 0.01 };
  });

  return (
    <div className="flex items-center h-20 my-2" role="img" aria-label={`${current} of ${target} ${unit} reached`}>
      <div className="h-2 w-16 shrink-0 rounded-l-full bg-zinc-400" />
      <div className="h-5 w-2 shrink-0 bg-zinc-500" />
      {plates.map((plate, i) => (
        <div
          key={i}
          className="ml-0.5 shrink-0 rounded-sm"
          style={{
            ...plateSize(plate.weight, unit),
            background: plate.lifted ? plate.color : "transparent",
            border: plate.lifted ? "1px solid rgba(0,0,0,0.15)" : "2px dashed #d4d4d8",
          }}
        />
      ))}
      <div className="ml-0.5 h-3 flex-1 rounded-r-full bg-zinc-300" />
    </div>
  );
}

function GoalCard({ goal, current, forecast, unit, onRemove }) {
  const daysLeft = goal.deadline ? daysBetween(today(), goal.deadline) : null;
  const reached = current >= goal.target;
  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <h2 className="gb-display text-2xl font-bold text-zinc-900 leading-tight">
          {goal.exercise} {goal.target} {unit}
        </h2>
        <DeleteButton label="Delete goal" onConfirm={onRemove} />
      </div>
      <LoadedBar target={goal.target} current={current} unit={unit} />
      <div className="flex justify-between text-sm text-zinc-600">
        <span>{reached ? "Reached. Time for a new goal." : `Best est. 1RM: ${current || "none yet"}${current ? ` ${unit}` : ""}`}</span>
        {daysLeft !== null && !reached && <span>{daysLeft >= 0 ? `${daysLeft} days left` : "Deadline passed"}</span>}
      </div>
      {!reached && <p className="mt-2 text-sm text-zinc-700">{forecastText(forecast, unit)}</p>}
    </Panel>
  );
}

function GoalsView({ settings, setSettings, records, workouts }) {
  const { profile, goals } = settings;
  const [draft, setDraft] = useState({ exercise: "", target: "", deadline: "" });

  const updateProfile = (field) => (value) => setSettings((s) => ({ ...s, profile: { ...s.profile, [field]: value } }));
  const removeGoal = (id) => setSettings((s) => ({ ...s, goals: s.goals.filter((g) => g.id !== id) }));
  const trainingDays = profile.trainingDays ?? [];

  // Picking training days also sets sessions per week, so the two never disagree.
  function toggleDay(day) {
    const next = trainingDays.includes(day) ? trainingDays.filter((d) => d !== day) : [...trainingDays, day];
    setSettings((s) => ({ ...s, profile: { ...s.profile, trainingDays: next, daysPerWeek: next.length || s.profile.daysPerWeek } }));
  }

  function addGoal() {
    const exercise = normalizeName(draft.exercise);
    const target = Number(draft.target);
    if (!exercise || !target) return;
    setSettings((s) => ({ ...s, goals: [...s.goals, { id: crypto.randomUUID(), exercise, target, deadline: draft.deadline }] }));
    setDraft({ exercise: "", target: "", deadline: "" });
  }

  return (
    <div className="space-y-4">
      <ViewTitle>Goals</ViewTitle>

      {goals.length > 0 && (
        <p className="-mt-2 text-sm text-zinc-500">Forecasts extend your last 12 weeks of progress. Gains usually slow as you get stronger, so treat dates as rough.</p>
      )}
      {goals.map((goal) => (
        <GoalCard
          key={goal.id}
          goal={goal}
          current={records[goal.exercise]?.e1rm ?? 0}
          forecast={goalForecast(workouts, goal, records[goal.exercise]?.e1rm ?? 0)}
          unit={profile.unit} onRemove={() => removeGoal(goal.id)} />
      ))}

      <Panel className="space-y-3">
        <SectionTitle>New goal</SectionTitle>
        <Field label="Exercise">
          <input list="exercise-names" value={draft.exercise} onChange={(e) => setDraft({ ...draft, exercise: e.target.value })} placeholder="Bench Press" className={inputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={`Target 1RM (${profile.unit})`}>
            <input type="number" inputMode="decimal" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} className={inputClass} />
          </Field>
          <Field label="By (optional)">
            <input type="date" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} className={inputClass} />
          </Field>
        </div>
        <PrimaryButton onClick={addGoal} disabled={!draft.exercise.trim() || !Number(draft.target)}>
          Add goal
        </PrimaryButton>
      </Panel>

      <Panel className="space-y-3">
        <div>
          <SectionTitle>About you</SectionTitle>
          <p className="-mt-1 text-sm text-zinc-500">Your coach uses this to tailor advice.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Units">
            <Select value={profile.unit} options={["kg", "lb"]} onChange={updateProfile("unit")} />
          </Field>
          <Field label={`Bodyweight (${profile.unit})`}>
            <input type="number" inputMode="decimal" value={profile.bodyweight} onChange={(e) => updateProfile("bodyweight")(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Experience">
            <Select value={profile.experience} options={EXPERIENCE_LEVELS} onChange={updateProfile("experience")} />
          </Field>
          <Field label="Sessions per week">
            <input type="number" inputMode="numeric" min="1" max="7" value={profile.daysPerWeek} onChange={(e) => updateProfile("daysPerWeek")(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Main focus" className="col-span-2">
            <Select value={profile.focus} options={TRAINING_FOCUSES} onChange={updateProfile("focus")} />
          </Field>
          <div className="col-span-2">
            <span className="mb-1 block text-sm text-zinc-500">Training days</span>
            <div className="flex gap-1.5">
              {WEEKDAYS.map(({ day, label }) => {
                const on = trainingDays.includes(day);
                return (
                  <button
                    key={day}
                    onClick={() => toggleDay(day)}
                    aria-pressed={on}
                    className={`h-10 flex-1 rounded-lg border text-sm font-semibold ${on ? "border-blue-700 bg-blue-700 text-white" : "border-zinc-300 text-zinc-600"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="Usual time">
            <input type="time" value={profile.trainingTime ?? ""} onChange={(e) => updateProfile("trainingTime")(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Food preferences" className="col-span-2">
            <input
              value={profile.foodNotes ?? ""}
              onChange={(e) => updateProfile("foodNotes")(e.target.value)}
              placeholder="Vegetarian, no dairy, quick meals"
              className={inputClass}
            />
          </Field>
          <Field label="Coaching style" className="col-span-2">
            <Select value={profile.coachStyle ?? DEFAULT_SETTINGS.profile.coachStyle} options={Object.keys(COACH_STYLES)} onChange={updateProfile("coachStyle")} />
          </Field>
          <Field label="Injuries and equipment" className="col-span-2">
            <textarea
              rows={3}
              value={profile.notes}
              onChange={(e) => updateProfile("notes")(e.target.value)}
              placeholder="Home gym with a rack and dumbbells up to 30 kg. Left shoulder gets cranky on overhead work."
              className={inputClass}
            />
          </Field>
        </div>
      </Panel>
    </div>
  );
}

/* ───────────────────────────── Rest timer ───────────────────────────── */

const REST_FINISHED_DISPLAY_MS = 4000;

// Two short beeps. Silently does nothing if audio isn't available.
function playChime(audio) {
  try {
    [0, 0.3].forEach((offset) => {
      const start = audio.currentTime + offset;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.2);
    });
  } catch {
    // No sound support: the vibration and on-screen message still fire.
  }
}

// Counts down from a fixed end time, so it stays accurate even if the browser throttles the tab.
function useRestTimer() {
  const [rest, setRest] = useState(null); // { label, duration (s), endsAt (ms) }
  const [now, setNow] = useState(Date.now());
  const audioRef = useRef(null);

  useEffect(() => {
    if (!rest) return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [rest]);

  const remaining = rest ? Math.max(0, Math.ceil((rest.endsAt - now) / 1000)) : 0;
  const finished = Boolean(rest) && remaining === 0;

  useEffect(() => {
    if (!finished) return;
    if (audioRef.current) playChime(audioRef.current);
    navigator.vibrate?.([200, 100, 200]);
    const hide = setTimeout(() => setRest(null), REST_FINISHED_DISPLAY_MS);
    return () => clearTimeout(hide);
  }, [finished]);

  function start(seconds, label) {
    // Audio must be unlocked during a tap, so the chime can play later.
    if (!audioRef.current) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioRef.current = AudioContextClass ? new AudioContextClass() : null;
    }
    audioRef.current?.resume?.();
    setNow(Date.now());
    setRest({ label, duration: seconds, endsAt: Date.now() + seconds * 1000 });
  }

  const adjust = (seconds) =>
    setRest((r) => r && { ...r, duration: Math.max(1, r.duration + seconds), endsAt: Math.max(Date.now(), r.endsAt + seconds * 1000) });

  const stop = () => setRest(null);

  return { rest, remaining, finished, start, adjust, stop };
}

function TimerButton({ children, onClick, label }) {
  return (
    <button onClick={onClick} aria-label={label} className="rounded-lg bg-zinc-700 px-3 py-2 text-sm font-semibold text-white">
      {children}
    </button>
  );
}

function RestTimerBar({ timer }) {
  const { rest, remaining, finished, adjust, stop } = timer;
  if (!rest) return null;
  const progress = Math.min(1, remaining / rest.duration);

  return (
    <div className="fixed top-0 inset-x-0 z-10 bg-zinc-900 text-white">
      <div className="max-w-md mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-xs text-zinc-400">{finished ? "Rest over" : `Resting after ${rest.label}`}</div>
            <div className="gb-display text-4xl font-bold leading-none tabular-nums">{finished ? "Next set" : formatClock(remaining)}</div>
          </div>
          {!finished && (
            <div className="flex shrink-0 gap-2">
              <TimerButton label="15 seconds less" onClick={() => adjust(-15)}>−15</TimerButton>
              <TimerButton label="15 seconds more" onClick={() => adjust(15)}>+15</TimerButton>
              <TimerButton onClick={stop}>Skip</TimerButton>
            </div>
          )}
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-700">
          <div className="h-full bg-blue-500" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <span className="sr-only" aria-live="assertive">
        {finished ? "Rest over. Time for your next set." : ""}
      </span>
    </div>
  );
}

/* ───────────────────────────── App ───────────────────────────── */

const TABS = [
  { id: "coach", label: "Coach", Icon: MessageCircle },
  { id: "log", label: "Log", Icon: Dumbbell },
  { id: "form", label: "Form", Icon: Video },
  { id: "progress", label: "Progress", Icon: TrendingUp },
  { id: "goals", label: "Goals", Icon: Target },
];

function BottomNav({ tab, onSelect, workoutInProgress }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 h-16 bg-white border-t border-zinc-200">
      <div className="max-w-md mx-auto h-full grid grid-cols-5">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            aria-current={tab === id ? "page" : undefined}
            className={`relative flex flex-col items-center justify-center gap-0.5 text-xs ${tab === id ? "text-blue-700 font-semibold" : "text-zinc-500"}`}
          >
            <Icon className="w-5 h-5" />
            {label}
            {id === "log" && workoutInProgress && (
              <>
                <span className="absolute top-2 right-1/4 h-2.5 w-2.5 rounded-full bg-blue-700" />
                <span className="sr-only">, workout in progress</span>
              </>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}

export default function GymBot() {
  const [tab, setTab] = useState("coach");
  const restTimer = useRestTimer();
  const [detailsFor, setDetailsFor] = useState(null); // exercise shown in the details sheet
  const [workouts, setWorkouts, workoutsLoaded] = usePersistentState(STORAGE_KEYS.workouts, []);
  const [settings, setSettings, settingsLoaded] = usePersistentState(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
  const [chat, setChat, chatLoaded] = usePersistentState(STORAGE_KEYS.chat, []);
  const [formChecks, setFormChecks, formChecksLoaded] = usePersistentState(STORAGE_KEYS.formChecks, []);
  const [session, setSession, sessionLoaded] = usePersistentState(STORAGE_KEYS.session, null); // workout in progress

  const records = useMemo(() => personalRecords(workouts), [workouts]);
  const exerciseNames = useMemo(() => exercisesByFrequency(workouts), [workouts]);
  const plans = useMemo(() => buildAutopilotPlans(workouts, settings), [workouts, settings]);

  const setRepRange = (name, range) => setSettings((s) => ({ ...s, repRanges: { ...s.repRanges, [name]: range } }));

  const loaded = workoutsLoaded && settingsLoaded && chatLoaded && formChecksLoaded && sessionLoaded;
  const learnedMuscles = useLearnedMuscles({ enabled: loaded, exerciseNames });
  const exerciseContext = useMemo(() => ({ learnedMuscles, showDetails: setDetailsFor }), [learnedMuscles]);
  const coachContext = useMemo(
    () => buildCoachContext(settings, workouts, plans, learnedMuscles, session),
    [settings, workouts, plans, learnedMuscles, session]
  );
  const facts = useMemo(() => todayFacts({ workouts, settings, records, plans }), [workouts, settings, records, plans]);
  const coachStyle = settings.profile.coachStyle ?? DEFAULT_SETTINGS.profile.coachStyle;
  const dailyNote = useDailyNote({ enabled: loaded, facts, context: coachContext, style: coachStyle });
  const { unit, daysPerWeek, notes } = settings.profile;

  const views = {
    coach: <CoachView chat={chat} setChat={setChat} context={coachContext} briefing={{ facts, note: dailyNote }} onNavigate={setTab} />,
    log: (
      <LogView workouts={workouts} setWorkouts={setWorkouts} session={session} setSession={setSession} settings={settings} coachContext={coachContext} plans={plans} learnedMuscles={learnedMuscles} onRangeChange={setRepRange} onStartRest={restTimer.start} unit={unit} />
    ),
    form: <FormCheckView profileNotes={notes} formChecks={formChecks} setFormChecks={setFormChecks} />,
    progress: <ProgressView workouts={workouts} records={records} exerciseNames={exerciseNames} learnedMuscles={learnedMuscles} unit={unit} daysPerWeek={daysPerWeek} onNavigate={setTab} />,
    goals: <GoalsView settings={settings} setSettings={setSettings} records={records} workouts={workouts} />,
  };

  return (
    <ExerciseContext.Provider value={exerciseContext}>
      <div className="gb-root min-h-screen bg-zinc-100 text-zinc-800">
        <style>{GLOBAL_CSS}</style>
        <datalist id="exercise-names">
          {exerciseNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        {loaded ? (
          <>
            <RestTimerBar timer={restTimer} />
            <main className={`max-w-md mx-auto px-4 pb-24 ${restTimer.rest ? "pt-28" : "pt-6"}`}>{views[tab]}</main>
            <BottomNav tab={tab} onSelect={setTab} workoutInProgress={Boolean(session)} />
            {detailsFor && <ExerciseSheet name={detailsFor} onClose={() => setDetailsFor(null)} />}
          </>
        ) : (
          <div className="min-h-screen flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
          </div>
        )}
      </div>
    </ExerciseContext.Provider>
  );
}
