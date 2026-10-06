import { useState, useEffect } from "react";
import { Trash2, Loader2, Upload } from "lucide-react";
import { VIDEO_MARKER } from "../config.js";
import { parseRoutineTag } from "../workout.js";
import { VideoGuides } from "./videos.jsx";
import { guideFor } from "../training.js";

export const inputClass =
  "w-full rounded-lg bg-white border border-zinc-300 px-3 py-2.5 text-base text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-700";

export function Panel({ children, className = "" }) {
  return <section className={`rounded-2xl bg-white p-4 ${className}`}>{children}</section>;
}

export function ViewTitle({ children, action }) {
  return (
    <div className="flex items-end justify-between mb-4">
      <h1 className="gb-display text-4xl font-extrabold text-zinc-900 leading-none">{children}</h1>
      {action}
    </div>
  );
}

export const SectionTitle = ({ children }) => <h2 className="gb-display text-2xl font-bold text-zinc-900 mb-2">{children}</h2>;

export function Field({ label, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-sm text-zinc-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

export function Select({ value, options, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      {options.map((option) => (
        <option key={option}>{option}</option>
      ))}
    </select>
  );
}

export function PrimaryButton({ children, onClick, busy = false, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-700 text-white font-semibold py-3 disabled:opacity-40"
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

// The real <input> covers the whole drop zone (invisible), so a tap lands on it directly.
// In-app browsers often ignore a <label> forwarding clicks to a display:none input.
export function FilePicker({ title, hint, accept, busy = false, onFiles }) {
  function handleChange(event) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // allow picking the same file again
    if (files.length) onFiles(files);
  }

  return (
    <div className="relative flex flex-col items-center gap-1 rounded-xl border-2 border-dashed border-zinc-300 px-6 py-7 text-center">
      {busy ? <Loader2 className="w-6 h-6 animate-spin text-zinc-500" /> : <Upload className="w-6 h-6 text-zinc-500" />}
      <span className="font-semibold text-zinc-800">{title}</span>
      {hint && <span className="text-sm text-zinc-500">{hint}</span>}
      <input
        type="file"
        accept={accept}
        multiple
        disabled={busy}
        onChange={handleChange}
        aria-label={title}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </div>
  );
}

// Two-step confirm: the first tap arms it for 3 seconds, the second tap acts.
export function useArmed() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  return [armed, () => setArmed(true)];
}

export function DeleteButton({ onConfirm, label = "Delete" }) {
  const [armed, arm] = useArmed();
  return armed ? (
    <button onClick={onConfirm} className="text-sm font-semibold text-red-600">
      Tap to delete
    </button>
  ) : (
    <button onClick={arm} aria-label={label} className="text-zinc-400 hover:text-red-600">
      <Trash2 className="w-4 h-4" />
    </button>
  );
}

export const ErrorText = ({ message }) => (message ? <p className="text-sm text-red-600">{message}</p> : null);

export function renderBold(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-zinc-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  );
}

// Minimal markdown: headings, "- " bullets and **bold**, plus the coach's video and plan tags.
export function RichText({ text, onSaveRoutine }) {
  const lines = text.split("\n").filter((line) => line.trim());
  return (
    <div className="space-y-1.5 leading-relaxed">
      {lines.map((line, i) => {
        const isBullet = /^\s*[-*•]\s+/.test(line);
        const videoExercise = line.match(VIDEO_MARKER)?.[1];
        if (videoExercise) {
          const guide = guideFor(videoExercise);
          return guide ? <VideoGuides key={i} guide={guide} /> : null; // not in the library: show nothing
        }
        const routine = parseRoutineTag(line);
        if (routine) return <RoutineSuggestion key={i} routine={routine} onSave={onSaveRoutine} />;
        const isHeading = /^#{1,4}\s/.test(line);
        const content = renderBold(line.replace(/^\s*[-*•]\s+/, "").replace(/^#{1,4}\s/, ""));
        if (isHeading) return <p key={i} className="font-semibold text-zinc-900 pt-1">{content}</p>;
        if (isBullet)
          return (
            <div key={i} className="flex gap-2">
              <span className="text-blue-700">–</span>
              <span>{content}</span>
            </div>
          );
        return <p key={i}>{content}</p>;
      })}
    </div>
  );
}

// A workout plan the coach suggested. Only the coach chat can save it.
export function RoutineSuggestion({ routine, onSave }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="rounded-xl border-2 border-zinc-200 p-3">
      <div className="font-semibold text-zinc-900">{routine.name}</div>
      <ol className="text-sm">
        {routine.exercises.map((name, i) => (
          <li key={name}>
            {i + 1}. {name}
          </li>
        ))}
      </ol>
      {onSave && (
        <button
          onClick={() => {
            onSave(routine);
            setSaved(true);
          }}
          disabled={saved}
          aria-label={`Save plan ${routine.name}`}
          className="mt-2 rounded-full border border-blue-700 px-3 py-1 text-sm font-semibold text-blue-700 disabled:opacity-40"
        >
          {saved ? "Saved" : "Save plan"}
        </button>
      )}
    </div>
  );
}
