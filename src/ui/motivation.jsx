import { useState, useEffect, useRef } from "react";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import { COACH_STYLES, MAX_TODAY_FACTS, STORAGE_KEYS } from "../config.js";
import { MOTIVATION_PROMPT } from "../prompts.js";
import { usePersistentState } from "../storage.js";
import { askAI } from "../ai.js";
import { today } from "../dates.js";
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

export function SessionHighlights({ facts, onClose, onContinue }) {
  return (
    <section className="rounded-2xl bg-zinc-900 p-4 text-white">
      <div className="mb-2 flex items-start justify-between">
        <h2 className="gb-display text-2xl font-bold">Session saved</h2>
        <button onClick={onClose} aria-label="Close" className="text-zinc-400">
          <X className="w-5 h-5" />
        </button>
      </div>
      <FactList facts={facts} />
      {onContinue && (
        <button onClick={onContinue} className="mt-3 w-full rounded-lg border border-zinc-500 py-2.5 font-semibold text-white">
          Continue this workout
        </button>
      )}
    </section>
  );
}
