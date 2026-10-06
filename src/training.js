import { PLATES, VIDEO_LIBRARY } from "./config.js";
import { formatShortDate, parseDate, toDateKey, today, weekStart } from "./dates.js";

export const normalizeName = (name) => name.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
// "Bench Press (Barbell)" from other apps becomes "Bench Press"; other equipment stays in the name.
export const cleanExerciseName = (name) => normalizeName(String(name ?? "").replace(/\s*\(barbell\)\s*$/i, ""));

// The library entry for an exercise, or null if the library doesn't cover it.
export function guideFor(exercise) {
  const name = cleanExerciseName(exercise).toLowerCase();
  return VIDEO_LIBRARY.find((guide) => guide.match.test(name)) ?? null;
}
export const round1 = (n) => Math.round(n * 10) / 10;

// Epley formula.
export const estimate1RM = ({ weight, reps }) => (reps <= 1 ? weight : weight * (1 + reps / 30));

export const setsOf = (workout) => workout.exercises.flatMap((e) => e.sets);
export const workoutVolume = (workout) => setsOf(workout).reduce((sum, s) => sum + s.weight * s.reps, 0);
export const sortNewestFirst = (workouts) => [...workouts].sort((a, b) => b.date.localeCompare(a.date));
export const sortOldestFirst = (workouts) => [...workouts].sort((a, b) => a.date.localeCompare(b.date));
export const lastGymWorkout = (workouts) => sortNewestFirst(workouts).find((w) => w.exercises.length > 0) ?? null;
export const newId = () => crypto.randomUUID();

export function describeSets(sets, unit) {
  const load = (w) => (w ? `${w}` : "BW");
  const uniform = sets.every((s) => s.reps === sets[0].reps && s.weight === sets[0].weight);
  if (uniform) return `${sets.length}×${sets[0].reps} @ ${load(sets[0].weight)}${sets[0].weight ? ` ${unit}` : ""}`;
  return sets.map((s) => `${load(s.weight)}×${s.reps}`).join(", ");
}

export function sanitizeExercises(raw) {
  return (raw?.exercises ?? [])
    .map((e) => ({
      name: cleanExerciseName(e.name),
      sets: (e.sets ?? [])
        .map((s) => ({ reps: Math.round(Number(s.reps) || 0), weight: Number(s.weight) || 0 }))
        .filter((s) => s.reps > 0),
    }))
    .filter((e) => e.name && e.sets.length);
}

export function personalRecords(workouts) {
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

export function exercisesByFrequency(workouts) {
  const counts = {};
  workouts.forEach((w) => w.exercises.forEach((e) => (counts[e.name] = (counts[e.name] || 0) + 1)));
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
}

export function exerciseTrend(workouts, name) {
  return sortOldestFirst(workouts).flatMap((workout) => {
    const sets = workout.exercises.filter((e) => e.name === name).flatMap((e) => e.sets);
    if (!sets.length) return [];
    return [{ date: formatShortDate(workout.date), e1rm: round1(Math.max(...sets.map(estimate1RM))) }];
  });
}

// Logging again on the same day replaces that day's entry.
export function logBodyweight(log, date, weight) {
  return [...log.filter((entry) => entry.date !== date), { date, weight }].sort((a, b) => a.date.localeCompare(b.date));
}

// The latest logged weight, else the single value profiles had before the log existed.
export const currentBodyweight = (log, profile) => log.at(-1)?.weight ?? (Number(profile.bodyweight) || null);

export function weeklyVolume(workouts, weeks = 8) {
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

export function platesPerSide(total, unit) {
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

export function plateSize(weight, unit) {
  const kg = unit === "kg" ? weight : weight * 0.4536;
  return { width: 6 + kg * 0.5, height: kg >= 10 ? 64 : 26 + kg * 3.5 };
}
