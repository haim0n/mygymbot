import { useState } from "react";
import { ACTIVITY_EFFORTS, ACTIVITY_TYPES } from "../config.js";
import { today } from "../dates.js";
import { newId } from "../training.js";
import { activityEntry, activitySummary, activityType, distanceUnitFor, summaryText } from "../activities.js";
import { Field, Panel, PrimaryButton, SectionTitle, inputClass } from "./primitives.jsx";
import { ChoiceRow } from "./check-in.jsx";

export function ActivityIcon({ type, size = 40 }) {
  const Icon = activityType(type).icon;
  return (
    <span role="img" aria-label={type} className="inline-flex shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700" style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.55)} />
    </span>
  );
}

export const emptyActivityForm = () => ({ date: today(), minutes: "", distance: "", effort: null, notes: "" });

// Small until you pick an activity; then it opens just the fields that activity needs.
export function ActivityPanel({ unit, onSave }) {
  const [type, setType] = useState(null);
  const [form, setForm] = useState(emptyActivityForm);
  const distanceUnit = type ? distanceUnitFor(type, unit) : null;
  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  function save() {
    const minutes = Math.round(Number(form.minutes));
    if (!type || !(minutes > 0)) return;
    const distance = distanceUnit ? Number(form.distance) || null : null;
    const activity = { id: newId(), type, minutes, distance, distanceUnit: distance ? distanceUnit : null, effort: form.effort };
    onSave(activityEntry(form.date, [activity], form.notes.trim()));
    setType(null);
    setForm(emptyActivityForm());
  }

  return (
    <Panel className="space-y-3">
      <div>
        <SectionTitle>Log an activity</SectionTitle>
        <p className="-mt-2 text-sm text-zinc-500">Running, swimming, yoga and more. Pick one to log it.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {ACTIVITY_TYPES.map(({ type: name, icon: Icon }) => (
          <button
            key={name}
            onClick={() => setType(type === name ? null : name)}
            aria-pressed={type === name}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${type === name ? "border-blue-700 bg-blue-700 text-white" : "border-zinc-300 text-zinc-700"}`}
          >
            <Icon size={16} />
            {name}
          </button>
        ))}
      </div>

      {type && (
        <div className="space-y-3 border-t border-zinc-200 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Minutes">
              <input type="number" inputMode="numeric" min="1" value={form.minutes} onChange={update("minutes")} className={inputClass} />
            </Field>
            {distanceUnit && (
              <Field label={`Distance (${distanceUnit})`}>
                <input type="number" inputMode="decimal" min="0" value={form.distance} onChange={update("distance")} placeholder="Optional" className={inputClass} />
              </Field>
            )}
            <Field label="Date" className={distanceUnit ? "col-span-2" : ""}>
              <input type="date" value={form.date} onChange={update("date")} className={inputClass} />
            </Field>
          </div>
          <ChoiceRow label="Effort (optional)" options={ACTIVITY_EFFORTS} value={form.effort} onChange={(effort) => setForm((f) => ({ ...f, effort }))} />
          <Field label="Notes (optional)">
            <input value={form.notes} onChange={update("notes")} placeholder="Intervals, felt light" className={inputClass} />
          </Field>
          <PrimaryButton onClick={save} disabled={!(Number(form.minutes) > 0)}>
            Save {type.toLowerCase()}
          </PrimaryButton>
        </div>
      )}
    </Panel>
  );
}

export function ActivityWeek({ workouts }) {
  const summary = activitySummary(workouts);
  if (!summary.length) return null;
  return (
    <Panel>
      <SectionTitle>Activities, last 7 days</SectionTitle>
      <ul className="divide-y divide-zinc-200">
        {summary.map((s) => (
          <li key={s.type} className="flex items-center gap-3 py-2">
            <ActivityIcon type={s.type} size={36} />
            <span className="flex-1 font-medium text-zinc-900">{s.type}</span>
            <span className="text-right text-sm text-zinc-600 tabular-nums">{summaryText(s)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
