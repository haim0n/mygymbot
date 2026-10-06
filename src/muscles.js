import { MUSCLES, MUSCLE_COLORS, MUSCLE_LABELS, MUSCLE_RULES, VOLUME_LEVELS } from "./config.js";
import { daysBetween, joinWords, today } from "./dates.js";

export function ruleMuscles(exerciseName) {
  const name = exerciseName.toLowerCase();
  const rule = MUSCLE_RULES.find((r) => r.match.test(name));
  return rule ? { primary: rule.primary, secondary: rule.secondary } : null;
}

// Built-in rules first, then what the coach classified. Null if the exercise is still unknown.
export const musclesFor = (exerciseName, learned) => ruleMuscles(exerciseName) ?? learned[exerciseName] ?? null;

export function sanitizeMuscles(raw) {
  const valid = (list) => (Array.isArray(list) ? list.filter((m) => MUSCLES.includes(m)) : []);
  return { primary: valid(raw?.primary), secondary: valid(raw?.secondary) };
}

// Sets per muscle over the last 7 days: a set counts fully for its main muscles and half for helpers.
export function weeklyMuscleSets(workouts, learned) {
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

export const volumeColor = (sets) => VOLUME_LEVELS.find((level) => sets >= level.min)?.color ?? MUSCLE_COLORS.idle;
export const formatSets = (sets) => (Number.isInteger(sets) ? String(sets) : sets.toFixed(1));

// "Chest, with triceps and shoulders"
export function describeMuscles({ primary, secondary }) {
  const words = (muscles) => joinWords(muscles.map((m) => MUSCLE_LABELS[m].toLowerCase()));
  const text = secondary.length ? `${words(primary)}, with ${words(secondary)}` : words(primary);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
