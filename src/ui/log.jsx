import { useState, useEffect, useRef } from "react";
import { Trash2, Plus, Sparkles, Loader2, X, Check, Timer, PlayCircle, ChevronUp, ChevronDown, ArrowUpDown, ArrowLeftRight } from "lucide-react";
import { PLAN_STATUS, REP_RANGES } from "../config.js";
import { LOG_PARSER_PROMPT } from "../prompts.js";
import { askAIForJson } from "../ai.js";
import { formatClock, formatDate, formatShortDate, formatVolume, today } from "../dates.js";
import { describeSets, lastGymWorkout, sanitizeExercises, sortNewestFirst, workoutVolume, guideFor } from "../training.js";
import { formatRange } from "../autopilot.js";
import { sessionHighlights } from "../motivation.js";
import { describeMuscles, musclesFor } from "../muscles.js";
import { addExercises, addSet, completeExercise, currentExerciseId, editSet, moveExercise, newExerciseSets, nextRoutine, planExercise, planSession, removeExercise, removeSet, repeatLastWorkout, replaceExercise, routineSession, sessionExercise, sessionSetCounts, sessionToWorkout, startSession, targetExercise, toggleSet, workoutToSession } from "../workout.js";
import { pendingCheckIn } from "../schedule.js";
import { activityEntry, activityLabel, paceText, sanitizeActivities } from "../activities.js";
import { DeleteButton, ErrorText, Field, Panel, PrimaryButton, SectionTitle, ViewTitle, inputClass, useArmed } from "./primitives.jsx";
import { SessionHighlights, WorkoutDone } from "./motivation.jsx";
import { VideoGuides } from "./videos.jsx";
import { ExercisePicker, ExerciseThumb } from "./exercises.jsx";
import { CheckInCard, CoachReply } from "./check-in.jsx";
import { ActivityIcon, ActivityPanel } from "./activities.jsx";
import { ImportPanel } from "./import-history.jsx";

export function useNow(intervalMs) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(tick);
  }, [intervalMs]);
  return now;
}

export function IconButton({ label, onClick, disabled = false, children }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} className="rounded-lg p-1.5 text-zinc-500 disabled:opacity-30">
      {children}
    </button>
  );
}

export function StartWorkoutPanel({ routines, next, planCount, lastWorkout, onStartRoutine, onDeleteRoutine, onStartPlan, onRepeatLast, onStartEmpty }) {
  const plural = (n) => `${n} ${n === 1 ? "exercise" : "exercises"}`;
  const outlineButton = "w-full rounded-lg border border-blue-700 py-2.5 font-semibold text-blue-700";
  const upNext = `Start with Up next (${plural(planCount)})`;
  return (
    <Panel className="space-y-3">
      <SectionTitle>Start a workout</SectionTitle>
      <p className="-mt-1 text-sm text-zinc-500">
        Once started, you can edit sets, reorder and remove exercises, and check off sets as you go. Nothing is lost if you close the app.
      </p>
      {routines.length > 0 ? (
        <ul className="divide-y divide-zinc-200">
          {routines.map((routine) => (
            <li key={routine.name} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-900">{routine.name}</span>
                  {routine === next && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">Next</span>}
                </div>
                <p className="text-sm text-zinc-500">{routine.exercises.join(", ")}</p>
              </div>
              <DeleteButton label={`Delete plan ${routine.name}`} onConfirm={() => onDeleteRoutine(routine.name)} />
              <button
                onClick={() => onStartRoutine(routine)}
                aria-label={`Start plan ${routine.name}`}
                className={`shrink-0 rounded-lg px-4 py-2 font-semibold ${routine === next ? "bg-blue-700 text-white" : "border border-blue-700 text-blue-700"}`}
              >
                Start
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">Doing the same workouts in turn, like A and B? Save one as a plan while you train it, or ask your coach to suggest some.</p>
      )}
      {planCount > 0 && (routines.length ? <button onClick={onStartPlan} className={outlineButton}>{upNext}</button> : <PrimaryButton onClick={onStartPlan}>{upNext}</PrimaryButton>)}
      {lastWorkout && (
        <button onClick={onRepeatLast} className={outlineButton}>
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
export function keepFieldInView(event) {
  const field = event.target;
  setTimeout(() => field.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
}

// A compact list for changing the order. Rows are short, so the whole workout fits on screen
// and the exercise you just moved stays highlighted, instead of a tall card jumping away from your finger.
export function ReorderList({ session, setSession, onDone }) {
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
            <ExerciseThumb name={exercise.name} size={36} interactive={false} />
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
export function SetRow({ set, number, unit, onEdit, children }) {
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
export function ExerciseCard({ exercise, unit, mode, isCurrent = false, update, onSetDone, onReplace }) {
  const [showVideo, setShowVideo] = useState(false);
  const guide = guideFor(exercise.name);
  const id = exercise.id;
  const live = mode === "live";
  const lastSet = exercise.sets.at(-1);
  const allDone = exercise.sets.every((set) => set.done);

  function toggle(set) {
    update((s) => toggleSet(s, id, set.id));
    if (!set.done) onSetDone(exercise, set);
  }

  return (
    <li data-exercise-id={id} className={`rounded-xl border-2 p-3 ${isCurrent ? "border-blue-700" : "border-zinc-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <ExerciseThumb name={exercise.name} size={52} />
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
          {live && !allDone && (
            <IconButton label={`Replace ${exercise.name}`} onClick={() => onReplace(exercise)}>
              <ArrowLeftRight className="w-5 h-5" />
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

export function ExerciseList({ session, setSession, unit, mode, onSetDone, onReplace }) {
  const [reordering, setReordering] = useState(false);
  const currentId = mode === "live" ? currentExerciseId(session) : null;
  const listRef = useRef(null);

  // Finishing an exercise brings the one you're on next into view, also when you went out of order and it is further up.
  const doneIds = session.exercises.filter((e) => e.sets.length && e.sets.every((set) => set.done)).map((e) => e.id);
  const previousDoneIds = useRef(doneIds);
  useEffect(() => {
    const justFinished = doneIds.some((id) => !previousDoneIds.current.includes(id));
    previousDoneIds.current = doneIds;
    if (justFinished && currentId) listRef.current?.querySelector(`[data-exercise-id="${currentId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

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
      <ol ref={listRef} className="space-y-3">
        {session.exercises.map((exercise) => (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            unit={unit}
            mode={mode}
            isCurrent={exercise.id === currentId}
            update={setSession}
            onSetDone={onSetDone}
            onReplace={onReplace}
          />
        ))}
      </ol>
    </div>
  );
}

export function SessionDetails({ session, setSession }) {
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

// Saves the workout's exercises, in order, as a plan to start from next time. An existing plan's name updates that plan.
export function SaveRoutineForm({ session, setSession, onSave }) {
  const [name, setName] = useState(null); // null while closed
  const [savedAs, setSavedAs] = useState("");

  function save() {
    onSave({ name, exercises: [...new Set(session.exercises.map((e) => e.name))] });
    setSession((s) => ({ ...s, routine: name.trim() })); // this workout counts as that plan, so the next one comes after it
    setSavedAs(name.trim());
    setName(null);
  }

  if (name === null)
    return (
      <button onClick={() => setName(session.routine ?? "")} className="text-sm font-semibold text-blue-700">
        {savedAs ? `Saved as plan ${savedAs}` : "Save as a plan"}
      </button>
    );
  return (
    <div className="flex gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Plan name, like A" aria-label="Plan name" className={inputClass} />
      <button onClick={save} disabled={!name.trim()} className="shrink-0 rounded-lg bg-zinc-900 px-4 font-semibold text-white disabled:opacity-40">
        Save
      </button>
    </div>
  );
}

export function WorkoutPanel({ session, setSession, unit, onFinish, onStartRest, onSaveRoutine, onFindExercise }) {
  const [discardArmed, armDiscard] = useArmed();
  const now = useNow(30_000);
  const { done, total } = sessionSetCounts(session);
  const minutes = Math.max(0, Math.floor((now - session.startedAt) / 60_000));

  // Rest after every set except the very last one of the workout.
  const onSetDone = (exercise, set) => {
    if (total - done > 1) onStartRest(exercise.rest, exercise.name, { exerciseId: exercise.id, setId: set.id });
  };

  return (
    <Panel className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle>{session.routine ? `Workout ${session.routine}` : "Workout"}</SectionTitle>
        <span className="text-sm text-zinc-500 tabular-nums">
          {minutes} min, {done} of {total} sets
        </span>
      </div>
      {session.exercises.length === 0 && <p className="-mt-1 text-sm text-zinc-500">Add exercises here or from Up next below.</p>}
      <ExerciseList session={session} setSession={setSession} unit={unit} mode="live" onSetDone={onSetDone} onReplace={onFindExercise} />
      <button onClick={() => onFindExercise(null)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-blue-700 py-2.5 font-semibold text-blue-700">
        <Plus className="w-5 h-5" />
        Add exercise
      </button>
      {session.exercises.length > 0 && <SaveRoutineForm session={session} setSession={setSession} onSave={onSaveRoutine} />}
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
export function WorkoutEditor({ workout, unit, onSave, onCancel }) {
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

export function LogView({ workouts, setWorkouts, session, setSession, settings, plans, yourExercises, learnedMuscles, coachContext, onRangeChange, onStartRest, onSaveRoutine, onDeleteRoutine, showImport, setShowImport, unit }) {
  const [description, setDescription] = useState("");
  const [picker, setPicker] = useState(null); // null while closed, else { replacing: the exercise to swap, or null to add one }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [highlights, setHighlights] = useState(null);
  const [finished, setFinished] = useState(null); // { session, workout, facts, minutes }: the finish screen, which can also undo the finish
  const [coachReply, setCoachReply] = useState(null);
  const checkInWorkout = pendingCheckIn(workouts);
  const routines = settings.routines ?? [];

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
      const parsed = await askAIForJson(LOG_PARSER_PROMPT, description);
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

  function pickExercise(name) {
    if (picker.replacing) setSession((s) => replaceExercise(s, picker.replacing.id, name, plans));
    else addToSession(targetExercise(name, plans, newExerciseSets()));
    setPicker(null);
  }

  // Takes the saved workout back and reopens it as it was, unfinished sets included.
  function continueWorkout() {
    setWorkouts((all) => all.filter((w) => w.id !== finished.workout.id));
    setSession(finished.session);
    setFinished(null);
  }

  function finishWorkout() {
    const workout = sessionToWorkout(session);
    const minutes = Math.max(0, Math.floor((Date.now() - session.startedAt) / 60_000));
    setFinished({ session, workout, facts: sessionHighlights(workout, workouts, settings), minutes });
    setWorkouts((all) => [...all, workout]);
    setSession(null);
    window.scrollTo({ top: 0 }); // after the finish screen, the check-in waits at the top
  }

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
      {finished && (
        <WorkoutDone {...finished} unit={unit} context={coachContext} onDone={() => setFinished(null)} onContinue={continueWorkout} />
      )}
      {checkInWorkout && !session && <CheckInCard key={checkInWorkout.id} workout={checkInWorkout} context={coachContext} onSave={saveCheckIn} />}
      {coachReply && <CoachReply text={coachReply} onClose={() => setCoachReply(null)} />}

      {showImport && <ImportPanel workouts={workouts} setWorkouts={setWorkouts} unit={unit} />}

      {session ? (
        <WorkoutPanel session={session} setSession={setSession} unit={unit} onFinish={finishWorkout} onStartRest={onStartRest} onSaveRoutine={onSaveRoutine} onFindExercise={(replacing) => setPicker({ replacing })} />
      ) : (
        <StartWorkoutPanel
          routines={routines}
          next={nextRoutine(routines, workouts)}
          onStartRoutine={(routine) => setSession(routineSession(routine, plans))}
          onDeleteRoutine={onDeleteRoutine}
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

      <Panel className="space-y-2">
        <SectionTitle>Describe what you did</SectionTitle>
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Squat 3x5 at 100, bench 80 for 8, 8, 7, then a 5 km run in 28 min"
          aria-label="Describe what you did"
          className={inputClass}
        />
        <button
          onClick={addFromDescription}
          disabled={busy || !description.trim()}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-blue-700 text-blue-700 font-semibold py-2.5 disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Add from description
        </button>
        <ErrorText message={error} />
      </Panel>

      {picker && <ExercisePicker yourNames={yourExercises} replacing={picker.replacing?.name} onPick={pickExercise} onClose={() => setPicker(null)} />}

      <WorkoutHistory
        workouts={workouts}
        unit={unit}
        onUpdate={(updated) => setWorkouts((all) => all.map((w) => (w.id === updated.id ? updated : w)))}
        onDelete={(id) => setWorkouts((all) => all.filter((w) => w.id !== id))}
      />
    </div>
  );
}

export const AUTOPILOT_PREVIEW_COUNT = 5;

// Up next shows only exercises that aren't in the workout yet, so it's clear what you're doing today.
export function AutopilotPanel({ plans, learnedMuscles, unit, inWorkout, addedNames, onAdd, onAddAll, onRangeChange, onStartRest }) {
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

export function PlanRow({ plan, muscles, unit, onAdd, onRangeChange, onRest }) {
  const [showVideos, setShowVideos] = useState(false);
  const guide = guideFor(plan.name);
  const { label, className } = PLAN_STATUS[plan.status];
  const { sets, reps, weight } = plan.target;
  const load = (w) => (w ? `${w} ${unit}` : "BW");

  return (
    <li className="py-3 flex gap-3">
      <ExerciseThumb name={plan.name} size={64} />
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

export const HISTORY_LIMIT = 20;

// Folded by default: one line with the count. Open it for one compact row per workout,
// and tap a row for its sets, Edit and Delete.
export function WorkoutHistory({ workouts, unit, onUpdate, onDelete }) {
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
                            <ExerciseThumb name={exercise.name} size={32} />
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
