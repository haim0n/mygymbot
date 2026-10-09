// Real coach replies for fixed scenarios, to judge a prompt change against the rules each scenario lists.
// Run: node scripts/coach_eval.mjs [NAME ...]  (no names: all). Real Gemini calls billed to mygymbot, about a cent a run.
// The system prompt is built exactly as the app builds it (COACH_PROMPT + buildCoachContext).
import { COACH_PROMPT } from "../src/prompts.js";
import { buildCoachContext } from "../src/coach-context.js";
import { buildAutopilotPlans } from "../src/autopilot.js";
import { startServer } from "../tests/e2e/helpers.mjs";
import { settings, userWorkout, yesterdayWorkout } from "../tests/fixtures.mjs";

const workouts = [userWorkout, yesterdayWorkout];
const knee = settings({ name: "Dana", notes: "Left knee hurts on deep squats", sessionMinutes: "45" });
const session = { exercises: [{ name: "Bench Press (Dumbbell)", sets: [{ weight: 44, reps: 10, done: true }, { weight: 44, reps: 10 }] }] };

const SCENARIOS = [
  {
    name: "injury-plan",
    settings: knee,
    messages: ["What should I do today?"],
    rules: ["Lightens, swaps or skips exercises that load the left knee", "Asks how the knee feels at most once", "Fits about 45 minutes"],
  },
  {
    name: "injury-known",
    settings: knee,
    messages: ["Knee feels fine today.", "Good to know.", "Plan my workout for today"],
    rules: ["Does not ask how the knee feels again", "Still plans around the knee", "Fits about 45 minutes"],
  },
  {
    name: "no-injury-chat",
    settings: knee,
    messages: ["How was my bench last week?"],
    rules: ["Answers with dates, weights and reps from the data", "Does not bring up the knee"],
  },
  {
    name: "between-sets",
    settings: settings(),
    session,
    messages: ["That felt heavy"],
    rules: ["1 to 3 short lines", "Says what to do with the next set"],
  },
  {
    name: "remember",
    settings: settings(),
    messages: ["I moved, I only have dumbbells at home now"],
    rules: ["Has a [remember: ...] line about training at home with dumbbells only", "Adapts the advice to dumbbells"],
  },
  {
    name: "food",
    settings: settings({ sex: "Female", birthYear: "1990", height: "168" }),
    messages: ["How much protein should I eat?"],
    rules: ["Gives grams per day from the 80 kg bodyweight (about 1.6-2.2 g/kg)", "No crash diet advice"],
  },
  {
    name: "onboarding",
    settings: settings(),
    workouts: [],
    messages: ["I want to get stronger"],
    rules: ["Asks one short question, in plain words", "No profile or plan tags yet"],
  },
];

const names = process.argv.slice(2);
const chosen = names.length ? SCENARIOS.filter((s) => names.includes(s.name)) : SCENARIOS;
const server = await startServer({}); // only for /api/ask: the server's Gemini call, as in the app
try {
  for (const scenario of chosen) {
    const history = scenario.workouts ?? workouts;
    const plans = buildAutopilotPlans(history, scenario.settings);
    const system = `${COACH_PROMPT}\n\n${buildCoachContext(scenario.settings, history, plans, {}, scenario.session ?? null)}`;
    // Earlier messages alternate athlete and coach, ending with the athlete's.
    const messages = scenario.messages.map((content, i) => ({ role: (scenario.messages.length - i) % 2 ? "user" : "assistant", content }));
    const response = await fetch(`${server.url}api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ system, messages }) });
    const { text, error } = await response.json();
    console.log(`## ${scenario.name}\n\nAthlete: ${scenario.messages.at(-1)}\n\nRules:\n${scenario.rules.map((r) => `- ${r}`).join("\n")}\n\nReply:\n\n${text ?? `ERROR: ${error}`}\n`);
  }
} finally {
  await server.close();
}
