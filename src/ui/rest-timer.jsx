import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { formatClock } from "../dates.js";
import { REST_FUN_PROMPT, REST_NOTE_PROMPT } from "../prompts.js";
import { askAI, askAIForJson } from "../ai.js";
import { REST_FUN_KINDS, SET_FEEL_SCROLL_DELAY_MS, SET_FEELS, STORAGE_KEYS, SWIPE_AWAY_PX } from "../config.js";
import { usePersistentState } from "../storage.js";
import { describeNextSet, nextReading, parseRestFun, readingFor, readingRunsLow, rememberSeen, restFunRequest, restNoteRequest, wantsRestNote } from "../workout.js";
import { reducedMotion, usePresence } from "./primitives.jsx";

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
  const progress = rest ? Math.min(1, Math.max(0, (rest.endsAt - now) / (rest.duration * 1000))) : 0; // exact, so the bar glides
  const finished = Boolean(rest) && remaining === 0;

  useEffect(() => {
    if (!finished) return;
    if (audioRef.current) playChime(audioRef.current);
    navigator.vibrate?.([200, 100, 200]);
    const hide = setTimeout(() => setRest(null), REST_FINISHED_DISPLAY_MS);
    return () => clearTimeout(hide);
  }, [finished]);

  // Audio must be unlocked during a tap, so the chime can play later.
  function unlockAudio() {
    if (!audioRef.current) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioRef.current = AudioContextClass ? new AudioContextClass() : null;
    }
    audioRef.current?.resume?.();
  }

  // A rest kept across a reload has no audio yet: the browser allows it only after a tap, so any tap counts.
  useEffect(() => {
    if (!rest || audioRef.current) return;
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    return () => window.removeEventListener("pointerdown", unlockAudio);
  }, [Boolean(rest)]);

  // `set` ({ exerciseId, setId }): the set just done, so its card can ask how it felt.
  function start(seconds, label, set = {}) {
    unlockAudio();
    setNow(Date.now());
    setRest({ label, duration: seconds, startedAt: Date.now(), endsAt: Date.now() + seconds * 1000, ...set });
  }

  // The bar shows the part of the rest still to go: less time shortens it, more time past the start fills it again.
  const adjust = (seconds) =>
    setRest((r) => {
      if (!r) return r;
      const endsAt = Math.max(Date.now(), r.endsAt + seconds * 1000);
      return { ...r, endsAt, duration: Math.max(r.duration, Math.ceil((endsAt - Date.now()) / 1000)) };
    });

  const stop = () => setRest(null);

  return { rest, remaining, progress, finished, start, adjust, stop };
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

// Something to read between sets that isn't training, when the athlete picked a kind in Profile. Batches of items are written
// into the session (one at the start of a workout, so the first rest has one, and another when few are left unread), and
// what was shown is remembered in the settings so later workouts don't repeat it. Each rest starts on the next item, and
// Next moves on within a rest. It waits on the rests that get a coach's note, so the bar shows one thing to read.
export function useRestFun({ rest, session, setSession, settings, setSettings }) {
  const kind = settings.restFun?.kind ?? "Off";
  const on = Boolean(REST_FUN_KINDS[kind]);
  const reading = session?.restReading;
  const asked = useRef(null); // the batch already asked for, so it's asked once
  useEffect(() => {
    if (!on || !session || (reading && !readingRunsLow(reading))) return;
    const { startedAt } = session;
    const batch = `${startedAt}:${reading?.items.length ?? 0}`;
    if (asked.current === batch) return;
    asked.current = batch;
    askAIForJson(REST_FUN_PROMPT, restFunRequest(kind, settings.restFun.topic, settings.restFun.seen))
      .then((answer) => {
        const items = parseRestFun(answer, kind);
        if (!items.length) return;
        setSession((s) => {
          if (s?.startedAt !== startedAt) return s;
          const current = s.restReading ?? { items: [], index: -1, restStartedAt: null };
          return { ...s, restReading: { ...current, items: [...current.items, ...items] } };
        });
        setSettings((s) => ({ ...s, restFun: { ...s.restFun, seen: rememberSeen(s.restFun?.seen, items) } }));
      })
      .catch(() => {}); // a rest without something to read is fine; the next rest or a reload tries again
  }, [on, session?.startedAt, reading?.items.length, reading?.index]);

  const coachRest = Boolean(rest && session && !session.coachQuiet && (wantsRestNote(session, rest.label) || session.coachNotes?.at(-1)?.restStartedAt === rest.startedAt));
  const moveOn = () => setSession((s) => (s?.restReading ? { ...s, restReading: nextReading(s.restReading, rest.startedAt) } : s));
  useEffect(() => {
    if (on && rest && !coachRest && reading && reading.restStartedAt !== rest.startedAt) moveOn();
  }, [on, rest?.startedAt, coachRest, Boolean(reading)]);

  const item = on && !coachRest ? readingFor(reading, rest) : null;
  if (!item) return null;
  const { reveal, next } = REST_FUN_KINDS[kind];
  return { ...item, key: `${rest.startedAt}:${reading.index}`, hint: reveal, nextLabel: next, onNext: reading.index + 1 < reading.items.length ? moveOn : null };
}

// A rest's reading: the answer shows on a tap, or by itself when the rest is over; Next brings another one. Swiping it
// sideways puts it away for this rest (a screen reader gets a Hide button instead). Only transform and opacity move.
function RestFun({ item, finished, onHide }) {
  const [revealed, setRevealed] = useState(false);
  const [dx, setDx] = useState(0);
  const [away, setAway] = useState(0); // -1 or 1 while it slides out
  const drag = useRef(null); // { x: where the finger went down, moved: past a tap }
  const down = (e) => {
    drag.current = { x: e.clientX, moved: false };
  };
  const move = (e) => {
    if (!drag.current) return;
    const distance = e.clientX - drag.current.x;
    if (!drag.current.moved && Math.abs(distance) > 8) {
      drag.current.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId); // only now, so a tap still reaches its button
    }
    if (drag.current.moved) setDx(distance);
  };
  const up = () => {
    if (!drag.current?.moved) {
      drag.current = null;
      return;
    }
    if (Math.abs(dx) < SWIPE_AWAY_PX) setDx(0);
    else if (reducedMotion()) onHide();
    else setAway(Math.sign(dx));
    setTimeout(() => (drag.current = null)); // after the click that ends a drag, which mustn't count as a tap
  };
  const dragging = drag.current?.moved && !away;
  return (
    <div
      role="group"
      aria-label="Something to read"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClickCapture={(e) => drag.current?.moved && e.stopPropagation()}
      onTransitionEnd={(e) => away && e.target === e.currentTarget && onHide()}
      className="gb-fade mt-2 select-none rounded-lg bg-zinc-800 px-3 py-2 text-sm leading-snug"
      style={{
        touchAction: "pan-y", // vertical scrolling stays the browser's; sideways is the swipe
        transform: `translateX(${away ? `${away * 110}%` : `${dx}px`})`,
        opacity: away ? 0 : 1 - Math.min(Math.abs(dx) / (SWIPE_AWAY_PX * 3), 0.5),
        transition: dragging ? "none" : "transform 200ms ease-out, opacity 200ms ease-out",
      }}
    >
      <p className="text-zinc-100">{item.text}</p>
      <button onClick={onHide} className="sr-only">
        Hide
      </button>
      <div className="mt-1 flex min-h-8 items-center justify-between gap-3">
        {item.reveal &&
          (revealed || finished ? (
            <p className="gb-fade font-semibold text-blue-300">{item.reveal}</p>
          ) : (
            <button onClick={() => setRevealed(true)} className="gb-tap font-semibold text-blue-300">
              {item.hint}
            </button>
          ))}
        {item.onNext && (
          <button onClick={item.onNext} className="gb-tap ml-auto shrink-0 font-semibold text-zinc-300">
            {item.nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export function TimerButton({ children, onClick, label }) {
  return (
    <button onClick={onClick} aria-label={label} className="h-11 min-w-11 rounded-lg bg-zinc-700 px-3 text-sm font-semibold text-white">
      {children}
    </button>
  );
}

// The rest bar: the countdown, what comes next, and the coach's note or something to read. It drops in from the top and
// slides back up when the rest ends. Reports its height, since the page starts below it.
export function RestTimerBar({ timer, next, unit, note, fun, onReply, onQuiet, onHeight }) {
  const { rest, remaining, progress, finished, adjust, stop } = timer;
  const { mounted, leaving, onAnimationEnd } = usePresence(Boolean(rest));
  const barRef = useRef(null);
  const lastView = useRef(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [hiddenIn, setHiddenIn] = useState(null); // the rest whose reading was swiped away
  const onHeightRef = useRef(onHeight);
  onHeightRef.current = onHeight;
  // Measured before the first paint, so the page doesn't move twice; the observer follows a note that comes later.
  useLayoutEffect(() => {
    if (!barRef.current) return;
    onHeightRef.current(barRef.current.offsetHeight);
    const observer = new ResizeObserver(() => barRef.current && onHeightRef.current(barRef.current.offsetHeight));
    observer.observe(barRef.current);
    return () => observer.disconnect();
  }, [mounted]);
  if (!mounted) return null;

  if (rest) {
    const sameExercise = next?.exercise.id === rest.exerciseId;
    lastView.current = (
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
          <div className="h-full origin-left bg-blue-500" style={{ transform: `scaleX(${progress})`, transition: "transform 250ms linear" }} />
        </div>
        {next && (
          <p className="mt-2 text-sm text-zinc-300">
            {!(finished && sameExercise) && <span className="font-semibold text-white">{sameExercise ? "Next set" : `Next: ${next.exercise.name}`} </span>}
            {describeNextSet(next, unit)}
          </p>
        )}
        {note && (
          <div className="gb-fade mt-1 flex items-center gap-1">
            <p onClick={() => setNoteOpen((open) => !open)} className={`flex-1 text-sm leading-snug text-zinc-200 ${noteOpen ? "" : "line-clamp-2"}`}>
              {note}
            </p>
            <button onClick={onReply} className="h-10 shrink-0 rounded-lg px-2 text-sm font-semibold text-blue-300">Reply</button>
            <button onClick={onQuiet} className="h-10 shrink-0 rounded-lg px-2 text-sm text-zinc-400">Quiet</button>
          </div>
        )}
        {fun && hiddenIn !== rest.startedAt && <RestFun key={fun.key} item={fun} finished={finished} onHide={() => setHiddenIn(rest.startedAt)} />}
        <span className="sr-only" aria-live="assertive">
          {finished ? "Rest over. Time for your next set." : ""}
        </span>
      </div>
    );
  }

  return (
    <div ref={barRef} onAnimationEnd={onAnimationEnd} aria-hidden={leaving || undefined} className={`fixed top-0 inset-x-0 z-10 bg-zinc-900 text-white shadow-lg ${leaving ? "gb-drop-out pointer-events-none" : "gb-drop-in"}`}>
      {lastView.current}
    </div>
  );
}

// One tap on how the set just done felt, under that set while you rest; the sets still to do move with it.
// `prompt`: { result: what the tap did, or null before it; onRate(feel) }. `scroll`: false when the list is already moving on
// to the next exercise, so the two scrolls don't fight.
export function SetFeel({ prompt, scroll }) {
  const ref = useRef(null);
  // Once open, and again when the bar grows, the row and its set must be in sight: clear of the rest bar on top and the tab
  // bar below. Not when you have scrolled away from it.
  useEffect(() => {
    if (!scroll) return;
    const show = setTimeout(() => {
      const box = ref.current?.getBoundingClientRect();
      if (box && box.bottom > 0 && box.top < innerHeight) ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, SET_FEEL_SCROLL_DELAY_MS);
    return () => clearTimeout(show);
  }, [prompt.barHeight]);
  return (
    // the top scroll margin takes in the set row above (44 px and its padding), so the set shows with its question
    <div ref={ref} className="pb-1.5 pl-7 pt-0.5" style={{ scrollMarginTop: 52, scrollMarginBottom: 12 }}>
      {prompt.result ? (
        <p className="gb-fade flex min-h-10 items-center rounded-xl bg-blue-50 px-3 py-2 text-sm font-medium text-blue-900">{prompt.result}</p>
      ) : (
        <div role="group" aria-label="How was that set?" className="flex gap-2">
          {SET_FEELS.map((feel) => (
            <button key={feel.id} onClick={() => prompt.onRate(feel.id)} className="h-10 flex-1 rounded-full bg-zinc-100 text-sm font-semibold text-zinc-700">
              {feel.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
