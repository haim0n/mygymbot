import { useState, useEffect, useRef } from "react";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import { COACH_STYLES, MAX_TODAY_FACTS, STORAGE_KEYS } from "../config.js";
import { MOTIVATION_PROMPT, WORKOUT_DONE_PROMPT } from "../prompts.js";
import { usePersistentState } from "../storage.js";
import { askAI } from "../ai.js";
import { formatVolume, today } from "../dates.js";
import { currentBodyweight, setsOf, workoutVolume } from "../training.js";
import { finishedWorkoutRequest } from "../workout.js";
import { Panel, reducedMotion, useBackToClose } from "./primitives.jsx";

export const TONE_DOT = { plan: "bg-blue-600", celebrate: "bg-green-500", nudge: "bg-amber-500", info: "bg-zinc-400" };

export function FactList({ facts, onAction }) {
  return (
    <ul className="space-y-2">
      {facts.map((fact, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[fact.tone]}`} />
          <span className="flex-1">{fact.text}</span>
          {fact.action && onAction && (
            <button onClick={() => onAction(fact.action)} className="gb-tap shrink-0 text-sm font-semibold text-blue-700">
              {fact.action.label}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// Once a day the coach writes a short note from today's facts. Cached, so reopening the app costs nothing.
export function useDailyNote({ enabled, facts, context, style }) {
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
    askAI(`${MOTIVATION_PROMPT}\nStyle: ${COACH_STYLES[style]}.`, [{ role: "user", content: `TODAY'S HIGHLIGHTS:\n${highlights}\n\n${context}` }])
      .then((text) => setNote({ key, text }))
      .catch(() => setFailed(true)); // the facts still show; the note is a bonus
  }, [enabled, noteLoaded, isFresh, key]); // facts/context are read once per day on purpose

  return { text: isFresh ? note.text : null, loading: enabled && !isFresh && !failed };
}

// On the Coach tab it stays pinned above the chat, so it is one line until tapped.
export function TodayCard({ facts, note, open, onToggle, onNavigate }) {
  const shown = facts.slice(0, MAX_TODAY_FACTS);
    return (
    // open, it scrolls inside; the faded bottom edge shows there is more
    <Panel className={`mb-3 ${open ? "max-h-[45dvh] overflow-y-auto overscroll-contain space-y-3 [mask-image:linear-gradient(to_bottom,black_calc(100%_-_24px),transparent)]" : "py-2"}`}>
      <h2>
        <button onClick={onToggle} aria-expanded={open} className="flex min-h-10 w-full items-center gap-3 text-left">
          <span className="gb-display text-2xl font-bold text-zinc-900">Today</span>
          <span className="flex-1 truncate text-zinc-600">{!open && shown[0]?.text}</span>
          {open ? <ChevronUp className="w-5 h-5 shrink-0 text-zinc-500" /> : <ChevronDown className="w-5 h-5 shrink-0 text-zinc-500" />}
        </button>
      </h2>
      {open && (
        <>
          {note.text && <p className="-mt-1 text-lg leading-snug text-zinc-900">{note.text}</p>}
          {note.loading && <p className="-mt-1 text-zinc-500">Your coach is writing today's note.</p>}
          <FactList facts={shown} onAction={(action) => onNavigate(action.tab)} />
        </>
      )}
    </Panel>
  );
}

export function SessionHighlights({ facts, onClose }) {
  return (
    <section className="rounded-2xl bg-zinc-900 p-4 text-white">
      <div className="mb-2 flex items-start justify-between">
        <h2 className="gb-display text-2xl font-bold">Session saved</h2>
        <button onClick={onClose} aria-label="Close" className="-m-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-400">
          <X className="w-5 h-5" />
        </button>
      </div>
      <FactList facts={facts} />
    </section>
  );
}

const BURST_COLORS = ["#1d4ed8", "#22c55e", "#facc15", "#f97316", "#ec4899", "#a855f7", "#38bdf8"];
const BURST_COUNT = 36;
// Two rings of dots and confetti, each piece at its own distance, size, spin and start, so it reads as a burst, not a pattern.
const BURST = Array.from({ length: BURST_COUNT }, (_, i) => {
  const angle = (i / BURST_COUNT) * 2 * Math.PI + (i % 2) * 0.17;
  const distance = 110 + ((i * 37) % 90);
  const confetti = i % 3 === 0;
  return {
    "--x": `${Math.round(Math.cos(angle) * distance)}px`,
    "--y": `${Math.round(Math.sin(angle) * distance * 0.8)}px`,
    "--size": `${confetti ? 9 : 6 + (i % 4) * 2}px`,
    "--spin": `${((i * 97) % 540) - 270}deg`,
    background: BURST_COLORS[i % BURST_COLORS.length],
    borderRadius: confetti ? "2px" : "9999px",
    animationDelay: `${(i % 4) * 60}ms`,
  };
});

const GRID_COLUMNS = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" }; // one per stat tile, as whole class names

// Counts a number up from 0 with an easing that slows near the end, so the stats land rather than flick. Starts after `delay`,
// when its card has risen into view.
function useCountUp(target, delay = 0, ms = 900) {
  const [value, setValue] = useState(reducedMotion() ? target : 0);
  useEffect(() => {
    if (reducedMotion()) {
      setValue(target);
      return;
    }
    let frame;
    const started = performance.now() + delay;
    const step = (time) => {
      const t = Math.min(1, Math.max(0, (time - started) / ms));
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

function Stat({ value, label, format = Math.round, delay }) {
  const shown = useCountUp(value, delay);
  return (
    <div className="gb-rise rounded-2xl bg-zinc-800 py-3" style={{ animationDelay: `${delay}ms` }}>
      <dd className="gb-display text-3xl font-bold tabular-nums">{format(shown)}</dd>
      <dt className="text-sm text-zinc-400">{label}</dt>
    </div>
  );
}

// The moment a workout is finished: what you did, what you beat, and a line from the coach. Continue undoes a finish tapped by
// mistake. It fades in over the page and out again; Android's Back is Done.
// Weighing in at the end of a workout, where athletes expect it; the history is in Progress.
function WeighIn({ log, profile, unit, onLog }) {
  const [draft, setDraft] = useState("");
  const weight = Number(draft);
  const logged = log.at(-1)?.date === today() ? log.at(-1).weight : null;
  const last = currentBodyweight(log, profile);
  function save() {
    if (!(weight > 0)) return;
    onLog(weight);
    setDraft("");
  }
  if (logged) return <p className="gb-fade flex min-h-11 items-center text-sm text-zinc-400">Bodyweight today: {logged} {unit}. Your history is in Progress.</p>;
  return (
    <div className="flex gap-2">
      <input
        type="number"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder={last ? `Bodyweight (last ${last} ${unit})` : `Bodyweight (${unit})`}
        aria-label="Bodyweight today"
        className="h-11 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
      />
      <button onClick={save} disabled={!(weight > 0)} className="h-11 shrink-0 rounded-lg bg-zinc-700 px-4 font-semibold text-white disabled:opacity-40">
        Log
      </button>
    </div>
  );
}

export function WorkoutDone({ workout, minutes, facts, unit, context, bodyweight, onDone, onContinue }) {
  const [coachLine, setCoachLine] = useState("");
  const [leaving, setLeaving] = useState(null); // the action to run once faded out
  const doneRef = useRef(null);
  const sets = setsOf(workout).length;
  const volume = workoutVolume(workout); // 0 for bodyweight work: no tile, a big 0 is nothing to celebrate
  const leave = (action) => {
    if (leaving) return; // a second tap while it fades would land on the page behind
    reducedMotion() ? action() : setLeaving(() => action);
  };
  useBackToClose(() => leave(onDone));

  useEffect(() => {
    doneRef.current.focus({ preventScroll: true });
    navigator.vibrate?.([80, 60, 80, 60, 160]);
    askAI(`${WORKOUT_DONE_PROMPT}\n\n${context}`, [{ role: "user", content: finishedWorkoutRequest(workout, minutes, facts, unit) }])
      .then(setCoachLine)
      .catch(() => {}); // the numbers are the celebration; the line is a bonus
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="workout-done-title"
      onAnimationEnd={(event) => leaving && event.target === event.currentTarget && leaving()}
      className={`fixed inset-0 z-30 overflow-y-auto overflow-x-hidden bg-zinc-900 text-white ${leaving ? "gb-fade-out" : "gb-fade"}`}
      style={{ margin: 0 }}
    >
      <div className="mx-auto flex min-h-full max-w-md flex-col px-5 pb-8 pt-16">
        <div className="gb-burst relative py-6 text-center">
          {BURST.map((piece, i) => (
            <span key={i} aria-hidden="true" style={piece} />
          ))}
          <h2 id="workout-done-title" className="gb-display gb-pop relative text-5xl font-extrabold" style={{ animationDelay: "120ms" }}>
            Workout done
          </h2>
        </div>
        <dl className={`mt-4 grid gap-2 text-center ${GRID_COLUMNS[1 + Boolean(minutes) + (volume > 0)]}`}>
          {minutes && <Stat value={minutes} label="min" delay={350} />}
          <Stat value={sets} label={sets === 1 ? "set" : "sets"} delay={430} />
          {volume > 0 && <Stat value={volume} label={unit} format={(n) => formatVolume(Math.round(n))} delay={510} />}
        </dl>
        {facts.length > 0 && (
          <div className="gb-rise mt-5" style={{ animationDelay: "650ms" }}>
            <FactList facts={facts} />
          </div>
        )}
        {coachLine && (
          <p className="gb-rise mt-5 rounded-2xl bg-zinc-800 p-4 text-zinc-100">
            <span className="block text-xs font-semibold text-blue-300">Coach</span>
            {coachLine}
          </p>
        )}
        <div className="gb-rise mt-auto space-y-3 pt-8" style={{ animationDelay: "750ms" }}>
          <WeighIn {...bodyweight} unit={unit} />
          <button ref={doneRef} onClick={() => leave(onDone)} className="w-full rounded-lg bg-blue-700 py-3 font-semibold text-white">
            Done
          </button>
          <button
            onClick={() => {
              onContinue(); // the workout is back behind the screen as it fades
              leave(onDone);
            }}
            className="w-full py-3 text-sm font-semibold text-zinc-400"
          >
            Continue this workout
          </button>
        </div>
      </div>
    </div>
  );
}
