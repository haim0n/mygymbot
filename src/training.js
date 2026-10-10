import { EXERCISE_SEARCH_LIMIT, PLATES, VIDEO_LIBRARY } from "./config.js";
import { formatShortDate, parseDate, toDateKey, today, weekStart } from "./dates.js";
import { EXERCISE_PHOTOS } from "./exercise-photos.js";
import { PHOTO_MATCHES } from "./photo-matches.js";
import { musclesFor } from "./muscles.js";

export const normalizeName = (name) => name.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
// "Bench Press (Barbell)" from other apps becomes "Bench Press"; other equipment stays in the name.
export const cleanExerciseName = (name) => normalizeName(String(name ?? "").replace(/\s*\(barbell\)\s*$/i, ""));

// The library entry for an exercise, or null if the library doesn't cover it.
const photoKey = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const PHOTO_BY_KEY = new Map(EXERCISE_PHOTOS.map((id) => [photoKey(id), id]));
const MATCH_BY_KEY = new Map(Object.entries(PHOTO_MATCHES).map(([name, id]) => [photoKey(name), id]));

// The photo known without the AI: the same name, also with the equipment moved to the front ("Bench Press (Dumbbell)" =
// "Dumbbell Bench Press"), or the reviewed match for a common name. null: no photo fits; undefined: not known here.
export function knownPhoto(name) {
  const [, base, equipment] = name.match(/^(.*?)\s*\(([^()]*)\)$/) ?? [];
  return PHOTO_BY_KEY.get(photoKey(name)) ?? (base && PHOTO_BY_KEY.get(photoKey(equipment + base))) ?? MATCH_BY_KEY.get(photoKey(name));
}

// The photo showing how an exercise is done and on what: known without the AI, else the one the AI matched it to.
export function photoFor(name, learnedPhotos = {}) {
  const known = knownPhoto(name);
  if (known !== undefined) return known;
  return EXERCISE_PHOTOS.includes(learnedPhotos[name]) ? learnedPhotos[name] : null;
}

// The exercises the picker offers besides yours: common names first, then the photo library's own names.
const COMMON_NAMES = Object.keys(PHOTO_MATCHES);
const LIBRARY_NAMES = EXERCISE_PHOTOS.map((id) => id.replace(/^3_4_/, "3/4 ").replace(/_/g, " "));

// Exercises for the picker, yours first (most done first), then common names, then the library. Each typed word must start a
// word of the name ("chin" finds Chin Up, not Machine; "pullup" finds Pull Up). A muscle keeps the exercises that work it
// most, those that work it first ahead. The library comes in only when you search, as it is long.
export function searchExercises(query, yourNames, { muscle = null, learnedMuscles = {} } = {}) {
  const words = query.split(/\s+/).map(photoKey).filter(Boolean);
  const candidates = [...yourNames, ...COMMON_NAMES, ...(words.length || muscle ? LIBRARY_NAMES : [])];
  const seen = new Set();
  const found = candidates.filter((name) => {
    const key = photoKey(name);
    if (seen.has(key)) return false;
    seen.add(key);
    const nameWords = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const startsAWord = (word) => nameWords.some((_, i) => nameWords.slice(i).join("").startsWith(word));
    return words.every(startsAWord) && (!muscle || Boolean(musclesFor(name, learnedMuscles)?.primary.includes(muscle)));
  });
  const worksFirst = (name) => !muscle || musclesFor(name, learnedMuscles).primary[0] === muscle;
  return [...found.filter(worksFirst), ...found.filter((name) => !worksFirst(name))].slice(0, EXERCISE_SEARCH_LIMIT);
}

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
