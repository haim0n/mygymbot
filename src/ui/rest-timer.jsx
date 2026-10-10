import { useState, useEffect, useRef } from "react";
import { formatClock } from "../dates.js";
import { REST_NOTE_PROMPT } from "../prompts.js";
import { askAI } from "../ai.js";
import { SET_FEELS, STORAGE_KEYS } from "../config.js";
import { usePersistentState } from "../storage.js";
import { describeNextSet, feelResult, restNoteRequest, wantsRestNote } from "../workout.js";

export const REST_FINISHED_DISPLAY_MS = 4000;

// Two short beeps. Silently does nothing if audio isn't available.
export function playChime(audio) {
  try {
    [0, 0.3].forEach((offset) => {
      const start = audio.currentTime + offset;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.2);
    });
  } catch {
    // No sound support: the vibration and on-screen message still fire.
  }
}

// Counts down from a fixed end time, so it stays accurate even if the browser throttles the tab or the app reloads.
export function useRestTimer() {
  const [stored, setRest] = usePersistentState(STORAGE_KEYS.rest, null);
  const [now, setNow] = useState(Date.now());
  const [openedAt] = useState(now);
  const rest = stored && (stored.startedAt >= openedAt || openedAt < stored.endsAt + REST_FINISHED_DISPLAY_MS) ? stored : null; // one that ended while the app was closed is over
  const audioRef = useRef(null);

  useEffect(() => {
    if (!rest) return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [rest]);

  const remaining = rest ? Math.max(0, Math.ceil((rest.endsAt - now) / 1000)) : 0;
  const finished = Boolean(rest) && remaining === 0;

  useEffect(() => {
    if (!finished) return;
    if (audioRef.current) playChime(audioRef.current);
    navigator.vibrate?.([200, 100, 200]);
    const hide = setTimeout(() => setRest(null), REST_FINISHED_DISPLAY_MS);
    return () => clearTimeout(hide);
  }, [finished]);

  // `set` ({ exerciseId, setId }): the set just done, so the bar can ask how it felt.
  function start(seconds, label, set = {}) {
    // Audio must be unlocked during a tap, so the chime can play later.
    if (!audioRef.current) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioRef.current = AudioContextClass ? new AudioContextClass() : null;
    }
    audioRef.current?.resume?.();
    setNow(Date.now());
    setRest({ label, duration: seconds, startedAt: Date.now(), endsAt: Date.now() + seconds * 1000, ...set });
  }

  const adjust = (seconds) =>
    setRest((r) => r && { ...r, duration: Math.max(1, r.duration + seconds), endsAt: Math.max(Date.now(), r.endsAt + seconds * 1000) });

  const stop = () => setRest(null);

  return { rest, remaining, finished, start, adjust, stop };
}

// The coach keeps the athlete company between sets with one short line, the first time each exercise rests.
// Notes live in the session, so a reload doesn't ask again and the coach knows what it already said.
export function useRestNote({ rest, session, setSession, context, chat }) {
  const requested = useRef(null);
  useEffect(() => {
    if (!rest || requested.current === rest.startedAt || !wantsRestNote(session, rest.label)) return;
    requested.current = rest.startedAt;
    askAI(`${REST_NOTE_PROMPT}\n\n${context}`, [{ role: "user", content: restNoteRequest(session, rest.label, chat) }])
      .then((text) => setSession((s) => s && { ...s, coachNotes: [...(s.coachNotes ?? []), { exercise: rest.label, text, restStartedAt: rest.startedAt }] }))
      .catch(() => {}); // the timer is what matters; a rest without a note is fine
  }, [rest?.startedAt]);

  const latest = session?.coachNotes?.at(-1);
  return rest && session && !session.coachQuiet && latest?.restStartedAt === rest.startedAt ? latest.text : null; // the session can load after the rest
}

export function TimerButton({ children, onClick, label }) {
  return (
    <button onClick={onClick} aria-label={label} className="rounded-lg bg-zinc-700 px-3 py-2 text-sm font-semibold text-white">
      {children}
    </button>
  );
}

// The rest bar: the countdown, one tap on how the set felt (it moves the next sets), what comes next, and the coach's note.
// `rated`: { exercise, set } just done, or null for a rest started by hand. Reports its height, since the page starts below it.
export function RestTimerBar({ timer, rated, next, unit, onRate, note, onReply, onQuiet, onHeight }) {
  const { rest, remaining, finished, adjust, stop } = timer;
  const barRef = useRef(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const onHeightRef = useRef(onHeight);
  onHeightRef.current = onHeight;
  useEffect(() => {
    if (!barRef.current) return;
    const observer = new ResizeObserver(() => onHeightRef.current(barRef.current.offsetHeight));
    observer.observe(barRef.current);
    return () => observer.disconnect();
  }, [Boolean(rest)]);
  if (!rest) return null;
  const progress = Math.min(1, remaining / rest.duration);
  const sameExercise = next?.exercise.id === rest.exerciseId;
  const ratedText = rated && feelResult(rated.exercise, rated.set, unit);

  return (
    <div ref={barRef} className="fixed top-0 inset-x-0 z-10 bg-zinc-900 text-white">
      <div className="max-w-md mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-xs text-zinc-400">{finished ? "Rest over" : `Resting after ${rest.label}`}</div>
            <div className="gb-display text-4xl font-bold leading-none tabular-nums">{finished ? "Next set" : formatClock(remaining)}</div>
          </div>
          {!finished && (
            <div className="flex shrink-0 gap-2">
              <TimerButton label="15 seconds less" onClick={() => adjust(-15)}>−15</TimerButton>
              <TimerButton label="15 seconds more" onClick={() => adjust(15)}>+15</TimerButton>
              <TimerButton onClick={stop}>Skip</TimerButton>
            </div>
          )}
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-700">
          <div className="h-full bg-blue-500" style={{ width: `${progress * 100}%` }} />
        </div>
        {rated && !finished && (ratedText ? (
          <p className="mt-2 flex min-h-10 items-center text-sm text-zinc-200">{ratedText}</p>
        ) : (
          <div className="mt-2 flex gap-2" role="group" aria-label="How was that set?">
            {SET_FEELS.map((f) => (
              <button key={f.id} onClick={() => onRate(f.id)} className="h-10 flex-1 rounded-full bg-zinc-700 text-sm font-semibold text-white">
                {f.label}
              </button>
            ))}
          </div>
        ))}
        {next && (
          <p className="mt-2 text-sm text-zinc-300">
            {!(finished && sameExercise) && <span className="font-semibold text-white">{sameExercise ? "Next set" : `Next: ${next.exercise.name}`} </span>}
            {describeNextSet(next, unit)}
          </p>
        )}
        {note && (
          <div className="mt-2 flex items-start gap-3">
            <p onClick={() => setNoteOpen((open) => !open)} className={`flex-1 text-sm leading-snug text-zinc-200 ${noteOpen ? "" : "line-clamp-2"}`}>
              {note}
            </p>
            <button onClick={onReply} className="shrink-0 text-sm font-semibold text-blue-300">Reply</button>
            <button onClick={onQuiet} className="shrink-0 text-sm text-zinc-400">Quiet</button>
          </div>
        )}
      </div>
      <span className="sr-only" aria-live="assertive">
        {finished ? "Rest over. Time for your next set." : ""}
      </span>
    </div>
  );
}
