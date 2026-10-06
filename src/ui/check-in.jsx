import { useState } from "react";
import { X } from "lucide-react";
import { EFFORT_OPTIONS, PAIN_OPTIONS } from "../config.js";
import { CHECK_IN_PROMPT } from "../prompts.js";
import { askAI } from "../ai.js";
import { formatShortDate } from "../dates.js";
import { formatWorkoutLine } from "../coach-context.js";
import { ErrorText, Field, Panel, PrimaryButton, RichText, SectionTitle, inputClass } from "./primitives.jsx";

export function ChoiceRow({ label, options, value, onChange }) {
  return (
    <div role="radiogroup" aria-label={label}>
      <div className="mb-1 text-sm text-zinc-500">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            role="radio"
            aria-checked={value === option}
            onClick={() => onChange(option)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${value === option ? "border-blue-700 bg-blue-700 text-white" : "border-zinc-300 text-zinc-700"}`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

// The coach asks how the latest workout went. It stays until answered or skipped, even if the app is closed.
export function CheckInCard({ workout, context, onSave }) {
  const [effort, setEffort] = useState(null);
  const [pain, setPain] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setBusy(true);
    setError("");
    const answer = `effort ${effort}; pain ${pain}${note.trim() ? `; note: ${note.trim()}` : ""}`;
    try {
      const reply = await askAI(CHECK_IN_PROMPT, [
        { role: "user", content: `CHECK-IN for the ${workout.date} workout: ${answer}\nSESSION: ${formatWorkoutLine(workout)}\n\n${context}` },
      ]);
      onSave({ effort, pain, note: note.trim(), reply });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionTitle>How did it go?</SectionTitle>
          <p className="-mt-2 text-sm text-zinc-500">Your coach is checking in on your {formatShortDate(workout.date)} workout.</p>
        </div>
        <button onClick={() => onSave({ skipped: true })} className="shrink-0 pt-1 text-sm font-semibold text-zinc-500">
          Skip
        </button>
      </div>
      <ChoiceRow label="Effort" options={EFFORT_OPTIONS} value={effort} onChange={setEffort} />
      <ChoiceRow label="Any pain?" options={PAIN_OPTIONS} value={pain} onChange={setPain} />
      <Field label="Anything else? (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Slept badly, left knee felt tight" className={inputClass} />
      </Field>
      <PrimaryButton onClick={send} busy={busy} disabled={!effort || !pain}>
        Send to coach
      </PrimaryButton>
      <ErrorText message={error} />
    </Panel>
  );
}

export function CoachReply({ text, onClose }) {
  return (
    <Panel className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <SectionTitle>From your coach</SectionTitle>
        <button onClick={onClose} aria-label="Close" className="text-zinc-400">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="text-zinc-700">
        <RichText text={text} />
      </div>
    </Panel>
  );
}
