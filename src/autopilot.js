import { BIG_LIFT_EXTRA_REST, BIG_LOWER_BODY_LIFTS, DELOAD_FACTOR, EQUIPMENT_STEPS, MAX_DAYS_BEFORE_EASING_BACK, MUSCLE_LABELS, PLAN_LOOKBACK_DAYS, RANGE_HISTORY_SESSIONS, REP_RANGES, REST_BY_REP_RANGE } from "./config.js";
import { daysBetween, today } from "./dates.js";
import { exercisesByFrequency, sortOldestFirst } from "./training.js";
import { musclesFor } from "./muscles.js";

export const formatRange = ([min, max]) => `${min}–${max}`;
export const roundTo = (value, step) => Math.round(value / step) * step;
export const repeatSet = (count, { reps, weight }) => Array.from({ length: count }, () => ({ reps, weight }));

// What an exercise is done with, read from its name. Sets the weight step and the exercise icon.
export function equipmentOf(exerciseName) {
  const name = exerciseName.toLowerCase();
  if (name.includes("dumbbell")) return "dumbbell";
  if (name.includes("kettlebell")) return "kettlebell";
  if (/cable|pulldown|pushdown|crossover|face pull/.test(name)) return "cable";
  if (name.includes("machine") && !name.includes("smith")) return "machine";
  if (/pull[- ]?up|chin[- ]?up|push[- ]?up|\bdips?\b|plank|crunch|sit[- ]?up|leg raise|bodyweight/.test(name)) return "bodyweight";
  return BIG_LOWER_BODY_LIFTS.some((lift) => name.includes(lift)) ? "bigBarbell" : "barbell";
}

export const weightStep = (exerciseName, unit) => EQUIPMENT_STEPS[equipmentOf(exerciseName)][unit];

// The next weight that exists: 44 → 46 on 2 kg dumbbells; an off-grid 39 → 40 on a 5 kg stack.
export const nextWeightUp = (weight, step) => (Math.floor(weight / step + 1e-9) + 1) * step;

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Picks the preset whose midpoint is closest to your typical working-set reps.
// Midpoints keep it stable: cycling from the bottom to the top of a range has that range's midpoint as its median.
export function inferRepRange(history) {
  const typicalReps = median(history.slice(-RANGE_HISTORY_SESSIONS).flatMap((session) => session.reps));
  const distance = ([min, max]) => Math.abs((min + max) / 2 - typicalReps);
  return REP_RANGES.reduce((best, range) => (distance(range) < distance(best) ? range : best));
}

// One entry per session, oldest first. Working sets = the sets done at that session's top weight.
export function workingSetHistory(workouts, name) {
  return sortOldestFirst(workouts).flatMap((workout) => {
    const sets = workout.exercises.filter((e) => e.name === name).flatMap((e) => e.sets);
    if (!sets.length) return [];
    const weight = Math.max(...sets.map((s) => s.weight));
    const pain = workout.checkIn?.skipped ? undefined : workout.checkIn?.pain;
    const tooHard = sets.some((s) => s.weight === weight && s.feel === "hard");
    return [{ date: workout.date, weight, reps: sets.filter((s) => s.weight === weight).map((s) => s.reps), pain, tooHard }];
  });
}

export function prescribe(history, [min, max], step, injuredMuscle) {
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
  // ponytail: the check-in doesn't ask where it hurt, so pain holds every lift of that session; a body-area question would narrow it.
  if (last.pain && last.pain !== "No")
    return plan("hold", Math.min(max, Math.max(min, lowestReps)), last.weight, "You reported pain after the last session. Keep the weight until it's gone.");
  if (injuredMuscle)
    return plan("hold", Math.min(max, Math.max(min, lowestReps)), last.weight, `Easy on your ${MUSCLE_LABELS[injuredMuscle].toLowerCase()} (injuries in your profile). Keep the weight.`);
  if (lowestReps >= max && last.tooHard) return plan("hold", max, last.weight, "You rated your top set too hard last time. Keep the weight until it feels right.");
  if (lowestReps >= max) return plan("increase", min, nextWeightUp(last.weight, step), `Every set reached ${max} reps.`);
  if (!missedRange(last)) return plan("reps", Math.min(max, lowestReps + 1), last.weight, `Stay at this weight until every set reaches ${max}.`);
  if (previous && previous.weight === last.weight && missedRange(previous) && last.weight > 0)
    return plan("deload", min, deloadWeight, `Missed ${min} reps two sessions running. Drop 10% and build back.`);
  return plan("repeat", min, last.weight, `Fell short of ${min} reps. Repeat the weight.`);
}

export function restSeconds(exerciseName, [, maxReps]) {
  const base = REST_BY_REP_RANGE.find(([upTo]) => maxReps <= upTo)[1];
  return equipmentOf(exerciseName) === "bigBarbell" ? base + BIG_LIFT_EXTRA_REST : base;
}

// Muscles the profile's injury note affects, once read for the note as it is now; [] while it's being read.
export const injuredMuscles = ({ profile, injuryAreas }) => (injuryAreas && injuryAreas.notes === (profile.notes ?? "").trim() ? injuryAreas.muscles : []);

export function buildAutopilotPlans(workouts, settings, learnedMuscles = {}) {
  const { profile, repRanges = {} } = settings;
  const injured = injuredMuscles(settings);
  return exercisesByFrequency(workouts)
    .map((name) => ({ name, history: workingSetHistory(workouts, name) }))
    .filter(({ history }) => daysBetween(history.at(-1).date, today()) <= PLAN_LOOKBACK_DAYS)
    .map(({ name, history }) => {
      const range = repRanges[name] ?? inferRepRange(history); // a range you picked always wins
      const muscles = musclesFor(name, learnedMuscles);
      const injuredMuscle = muscles && [...muscles.primary, ...muscles.secondary].find((m) => injured.includes(m));
      return {
        name,
        range,
        rest: restSeconds(name, range),
        last: history.at(-1),
        ...prescribe(history, range, weightStep(name, profile.unit), injuredMuscle),
      };
    });
}
