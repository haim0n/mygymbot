import { useState, useEffect, useRef } from "react";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import { COACH_STYLES, MAX_TODAY_FACTS, STORAGE_KEYS } from "../config.js";
import { MOTIVATION_PROMPT, WORKOUT_DONE_PROMPT } from "../prompts.js";
import { usePersistentState } from "../storage.js";
import { askAI } from "../ai.js";
import { formatVolume, today } from "../dates.js";
import { setsOf, workoutVolume } from "../training.js";
import { finishedWorkoutRequest } from "../workout.js";
import { Panel } from "./primitives.jsx";

export const TONE_DOT = { plan: "bg-blue-600", celebrate: "bg-green-500", nudge: "bg-amber-500", info: "bg-zinc-400" };

export function FactList({ facts, onAction }) {
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
    <Panel className={`mb-3 ${open ? "max-h-[45dvh] overflow-y-auto overscroll-contain space-y-3" : "py-3"}`}>
      <h2>
        <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
          <span className="gb-display text-2xl font-bold text-zinc-900">Today</span>
          <span className="flex-1 truncate text-zinc-600">{!open && shown[0]?.text}</span>
          {open ? <ChevronUp className="w-5 h-5 shrink-0 text-zinc-500" /> : <ChevronDown className="w-5 h-5 shrink-0 text-zinc-500" />}
        </button>
      </h2>
      {open && (
        <>
          {note.text && <p className="-mt-1 text-lg leading-snug text-zinc-900">{note.text}</p>}
          {note.loading && <p className="-mt-1 text-zinc-400">Your coach is writing today's note.</p>}
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
        <button onClick={onClose} aria-label="Close" className="text-zinc-400">
          <X className="w-5 h-5" />
        </button>
      </div>
      <FactList facts={facts} />
    </section>
  );
}

const BURST_COLORS = ["#1d4ed8", "#22c55e", "#facc15", "#f97316", "#ec4899", "#a855f7"];
const BURST = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * 2 * Math.PI;
  const distance = 90 + (i % 3) * 35;
  return { x: `${Math.round(Math.cos(angle) * distance)}px`, y: `${Math.round(Math.sin(angle) * distance)}px`, color: BURST_COLORS[i % BURST_COLORS.length] };
});

// The moment a workout is finished: what you did, what you beat, and a line from the coach. Continue undoes a finish tapped by mistake.
export function WorkoutDone({ workout, minutes, facts, unit, context, onDone, onContinue }) {
  const [coachLine, setCoachLine] = useState("");
  const doneRef = useRef(null);
  const sets = setsOf(workout).length;

  useEffect(() => {
    doneRef.current.focus();
    navigator.vibrate?.([80, 60, 80, 60, 160]);
    askAI(`${WORKOUT_DONE_PROMPT}\n\n${context}`, [{ role: "user", content: finishedWorkoutRequest(workout, minutes, facts, unit) }])
      .then(setCoachLine)
      .catch(() => {}); // the numbers are the celebration; the line is a bonus
  }, []);

  const stats = [
    [minutes, "min"],
    [sets, sets === 1 ? "set" : "sets"],
    [formatVolume(workoutVolume(workout)), unit],
  ];
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="workout-done-title" className="fixed inset-0 z-30 overflow-y-auto bg-zinc-900 text-white" style={{ margin: 0 }}>
      <div className="mx-auto flex min-h-full max-w-md flex-col px-5 pb-8 pt-16">
        <div className="gb-burst relative py-6 text-center">
          {BURST.map((dot, i) => (
            <span key={i} aria-hidden="true" style={{ "--x": dot.x, "--y": dot.y, background: dot.color, animationDelay: `${(i % 3) * 80}ms` }} />
          ))}
          <h2 id="workout-done-title" className="gb-display relative text-5xl font-extrabold">Workout done</h2>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          {stats.map(([value, label]) => (
            <div key={label} className="rounded-2xl bg-zinc-800 py-3">
              <dd className="gb-display text-3xl font-bold tabular-nums">{value}</dd>
              <dt className="text-sm text-zinc-400">{label}</dt>
            </div>
          ))}
        </dl>
        {facts.length > 0 && (
          <div className="mt-5">
            <FactList facts={facts} />
          </div>
        )}
        {coachLine && (
          <p className="mt-5 rounded-2xl bg-zinc-800 p-4 text-zinc-100">
            <span className="block text-xs font-semibold text-blue-300">Coach</span>
            {coachLine}
          </p>
        )}
        <div className="mt-auto space-y-3 pt-8">
          <button ref={doneRef} onClick={onDone} className="w-full rounded-lg bg-blue-700 py-3 font-semibold text-white">
            Done
          </button>
          <button onClick={onContinue} className="w-full py-3 text-sm font-semibold text-zinc-400">
            Continue this workout
          </button>
        </div>
      </div>
    </div>
  );
}
