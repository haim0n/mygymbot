import { useState, useEffect, useRef } from "react";
import { formatClock } from "../dates.js";

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

// Counts down from a fixed end time, so it stays accurate even if the browser throttles the tab.
export function useRestTimer() {
  const [rest, setRest] = useState(null); // { label, duration (s), endsAt (ms) }
  const [now, setNow] = useState(Date.now());
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

  function start(seconds, label) {
    // Audio must be unlocked during a tap, so the chime can play later.
    if (!audioRef.current) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioRef.current = AudioContextClass ? new AudioContextClass() : null;
    }
    audioRef.current?.resume?.();
    setNow(Date.now());
    setRest({ label, duration: seconds, endsAt: Date.now() + seconds * 1000 });
  }

  const adjust = (seconds) =>
    setRest((r) => r && { ...r, duration: Math.max(1, r.duration + seconds), endsAt: Math.max(Date.now(), r.endsAt + seconds * 1000) });

  const stop = () => setRest(null);

  return { rest, remaining, finished, start, adjust, stop };
}

export function TimerButton({ children, onClick, label }) {
  return (
    <button onClick={onClick} aria-label={label} className="rounded-lg bg-zinc-700 px-3 py-2 text-sm font-semibold text-white">
      {children}
    </button>
  );
}

export function RestTimerBar({ timer }) {
  const { rest, remaining, finished, adjust, stop } = timer;
  if (!rest) return null;
  const progress = Math.min(1, remaining / rest.duration);

  return (
    <div className="fixed top-0 inset-x-0 z-10 bg-zinc-900 text-white">
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
      </div>
      <span className="sr-only" aria-live="assertive">
        {finished ? "Rest over. Time for your next set." : ""}
      </span>
    </div>
  );
}
