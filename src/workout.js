import { NEW_EXERCISE_TARGET, REST_NOTE_CHAT_MESSAGES, REST_NOTE_KINDS, ROUTINE_MARKER } from "./config.js";
import { today } from "./dates.js";
import { cleanExerciseName, lastGymWorkout, newId, sortNewestFirst } from "./training.js";
import { repeatSet, restSeconds } from "./autopilot.js";

// The workout in progress. It's saved as you go, so closing the app mid-session loses nothing.
// { date, startedAt, notes, exercises: [{ id, name, rest, sets: [{ id, weight, reps, done }] }] }
// Weights and reps may be strings while being typed; they become numbers when the workout is saved.
export const newSet = ({ weight, reps }, done = false) => ({ id: newId(), weight, reps, done });
export const startSession = () => ({ date: today(), startedAt: Date.now(), notes: "", exercises: [] });

// `sets` are { weight, reps } pairs; `done` marks them as already lifted (when logging after the fact).
export function sessionExercise(name, sets, { done = false, rest } = {}) {
  const firstReps = Number(sets[0]?.reps) || 8;
  return { id: newId(), name, rest: rest ?? restSeconds(name, [0, firstReps]), sets: sets.map((set) => newSet(set, done)) };
}

export const planExercise = (plan) => sessionExercise(plan.name, repeatSet(plan.target.sets, plan.target), { rest: plan.rest });

// Everything in Up next, in that order, at Autopilot's targets. Remove, reorder or edit once started.
export const planSession = (plans) => ({ ...startSession(), exercises: plans.map(planExercise) });

// One exercise at today's Autopilot target where there is one, else at `sets`.
export function targetExercise(name, plans, sets) {
  const plan = plans.find((p) => p.name === name);
  return plan ? planExercise(plan) : sessionExercise(name, sets);
}

// Your last workout's exercises, in the same order, at today's Autopilot targets where there is one. A repeat counts as the same workout plan.
export function repeatLastWorkout(workouts, plans) {
  const last = lastGymWorkout(workouts);
  return { ...startSession(), routine: last?.routine, exercises: (last?.exercises ?? []).map((e) => targetExercise(e.name, plans, e.sets)) };
}

// Saved workout plans are "routines" in code, since Autopilot's per-exercise targets are already "plans".
// A routine's exercises in its order, at Autopilot's targets. The workout keeps the routine's name, which decides the next one.
export function routineSession(routine, plans) {
  const newExerciseSets = repeatSet(NEW_EXERCISE_TARGET.sets, { reps: NEW_EXERCISE_TARGET.reps, weight: "" });
  return { ...startSession(), routine: routine.name, exercises: routine.exercises.map((name) => targetExercise(name, plans, newExerciseSets)) };
}

// Routines are done in turn: the one after the latest workout's routine, else the first.
export function nextRoutine(routines, workouts) {
  const lastName = sortNewestFirst(workouts).find((w) => w.routine)?.routine;
  return routines[(routines.findIndex((r) => r.name === lastName) + 1) % routines.length] ?? null;
}

// Saving under an existing name (any case) replaces that routine; that's how routines are edited.
export function saveRoutine(routines, { name, exercises }) {
  const routine = { name: name.trim(), exercises };
  const index = routines.findIndex((r) => r.name.toLowerCase() === routine.name.toLowerCase());
  return index < 0 ? [...routines, routine] : routines.map((r, i) => (i === index ? routine : r));
}

// "[plan: B: deadlift, Overhead Press]" → { name: "B", exercises: ["Deadlift", "Overhead Press"] }; null for any other line.
export function parseRoutineTag(line) {
  const match = line.match(ROUTINE_MARKER);
  const exercises = [...new Set((match?.[2] ?? "").split(",").map(cleanExerciseName).filter(Boolean))];
  return exercises.length ? { name: match[1], exercises } : null;
}

// Small, pure updates. Each returns a new session.
export const withExercises = (session, update) => ({ ...session, exercises: update(session.exercises) });
export const withExercise = (session, exerciseId, update) => withExercises(session, (list) => list.map((e) => (e.id === exerciseId ? update(e) : e)));
export const withSet = (session, exerciseId, setId, update) =>
  withExercise(session, exerciseId, (e) => ({ ...e, sets: e.sets.map((set) => (set.id === setId ? update(set) : set)) }));

export function moveItem(list, index, offset) {
  const target = index + offset;
  if (index < 0 || target < 0 || target >= list.length) return list;
  const moved = [...list];
  [moved[index], moved[target]] = [moved[target], moved[index]];
  return moved;
}

export const addExercises = (session, exercises) => withExercises(session, (list) => [...list, ...exercises]);
export const removeExercise = (session, exerciseId) => withExercises(session, (list) => list.filter((e) => e.id !== exerciseId));
export const moveExercise = (session, exerciseId, offset) =>
  withExercises(session, (list) => moveItem(list, list.findIndex((e) => e.id === exerciseId), offset));
export const toggleSet = (session, exerciseId, setId) => withSet(session, exerciseId, setId, (set) => ({ ...set, done: !set.done }));
export const editSet = (session, exerciseId, setId, field, value) => withSet(session, exerciseId, setId, (set) => ({ ...set, [field]: value }));
export const addSet = (session, exerciseId) =>
  withExercise(session, exerciseId, (e) => ({ ...e, sets: [...e.sets, newSet(e.sets.at(-1) ?? { weight: 0, reps: 8 })] }));
export const removeSet = (session, exerciseId, setId) => withExercise(session, exerciseId, (e) => ({ ...e, sets: e.sets.filter((set) => set.id !== setId) }));
export const completeExercise = (session, exerciseId) => withExercise(session, exerciseId, (e) => ({ ...e, sets: e.sets.map((set) => ({ ...set, done: true })) }));

export function sessionSetCounts(session) {
  const sets = session.exercises.flatMap((e) => e.sets);
  return { done: sets.filter((set) => set.done).length, total: sets.length };
}

// A saved workout as an editable session, so the same cards can fix it.
export function workoutToSession(workout) {
  return {
    date: workout.date,
    startedAt: null,
    notes: workout.notes ?? "",
    exercises: workout.exercises.map((e) => sessionExercise(e.name, e.sets, { done: true })),
  };
}

// The exercise you're on: the first one with sets still to do.
export const currentExerciseId = (session) => session.exercises.find((e) => e.sets.some((set) => !set.done))?.id ?? null;

// Only sets marked done are saved (or every set, when editing a saved workout); empty exercises are left out.
export function sessionToWorkout(session, { allSets = false } = {}) {
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
    ...(session.routine && { routine: session.routine }),
  };
}

// The coach's rest-screen note: once per exercise, at its first rest, unless the athlete asked for quiet.
export const wantsRestNote = (session, exerciseName) =>
  Boolean(session) && !session.coachQuiet && !(session.coachNotes ?? []).some((note) => note.exercise === exerciseName);

// What the coach is told when a rest starts: the set just done, the latest chat and what it already said this workout.
export function restNoteRequest(session, exerciseName, chat = []) {
  const sets = session.exercises.find((e) => e.name === exerciseName)?.sets ?? [];
  const done = sets.filter((set) => set.done);
  const last = done.at(-1);
  const earlier = (session.coachNotes ?? []).map((note) => `- ${note.text}`);
  const talk = chat.slice(-REST_NOTE_CHAT_MESSAGES).map((m) => `- ${m.role === "user" ? "athlete" : "coach"}: ${m.content}`);
  return [
    `RESTING after set ${done.length} of ${sets.length} of ${exerciseName}${last ? ` (${last.weight}x${last.reps})` : ""}.`,
    `Write ${REST_NOTE_KINDS[earlier.length % REST_NOTE_KINDS.length]}.`,
    talk.length > 0 && `LATEST COACH CHAT (oldest first):\n${talk.join("\n")}`,
    earlier.length > 0 && `You already said this workout:\n${earlier.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");
}
