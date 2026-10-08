import { useState } from "react";
import { APP_VERSION, COACH_STYLES, DEFAULT_SETTINGS, EXPERIENCE_LEVELS, MUSCLE_LABELS, PLATES, TRAINING_FOCUSES, WEEKDAYS } from "../config.js";
import { exportAllData } from "../storage.js";
import { daysBetween, joinWords, today } from "../dates.js";
import { normalizeName, plateSize, platesPerSide } from "../training.js";
import { injuredMuscles } from "../autopilot.js";
import { forecastText, goalForecast } from "../schedule.js";
import { DeleteButton, ErrorText, Field, Panel, PrimaryButton, SectionTitle, Select, ViewTitle, inputClass } from "./primitives.jsx";

// The target loaded on a barbell: plates you've already lifted are solid, the rest are outlines.
export function LoadedBar({ target, current, unit }) {
  let loaded = PLATES[unit].bar;
  const plates = platesPerSide(target, unit).map((plate) => {
    loaded += plate.weight * 2;
    return { ...plate, lifted: loaded <= current + 0.01 };
  });

  return (
    <div className="flex items-center h-20 my-2" role="img" aria-label={`${current} of ${target} ${unit} reached`}>
      <div className="h-2 w-16 shrink-0 rounded-l-full bg-zinc-400" />
      <div className="h-5 w-2 shrink-0 bg-zinc-500" />
      {plates.map((plate, i) => (
        <div
          key={i}
          className="ml-0.5 shrink-0 rounded-sm"
          style={{
            ...plateSize(plate.weight, unit),
            background: plate.lifted ? plate.color : "transparent",
            border: plate.lifted ? "1px solid rgba(0,0,0,0.15)" : "2px dashed #d4d4d8",
          }}
        />
      ))}
      <div className="ml-0.5 h-3 flex-1 rounded-r-full bg-zinc-300" />
    </div>
  );
}

export function GoalCard({ goal, current, forecast, unit, onRemove }) {
  const daysLeft = goal.deadline ? daysBetween(today(), goal.deadline) : null;
  const reached = current >= goal.target;
  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <h2 className="gb-display text-2xl font-bold text-zinc-900 leading-tight">
          {goal.exercise} {goal.target} {unit}
        </h2>
        <DeleteButton label="Delete goal" onConfirm={onRemove} />
      </div>
      <LoadedBar target={goal.target} current={current} unit={unit} />
      <div className="flex justify-between text-sm text-zinc-600">
        <span>{reached ? "Reached. Time for a new goal." : `Best est. 1RM: ${current || "none yet"}${current ? ` ${unit}` : ""}`}</span>
        {daysLeft !== null && !reached && <span>{daysLeft >= 0 ? `${daysLeft} days left` : "Deadline passed"}</span>}
      </div>
      {!reached && <p className="mt-2 text-sm text-zinc-700">{forecastText(forecast, unit)}</p>}
    </Panel>
  );
}

export function GoalsView({ settings, setSettings, records, workouts }) {
  const { profile, goals } = settings;
  const [draft, setDraft] = useState({ exercise: "", target: "", deadline: "" });

  const updateProfile = (field) => (value) => setSettings((s) => ({ ...s, profile: { ...s.profile, [field]: value } }));
  const removeGoal = (id) => setSettings((s) => ({ ...s, goals: s.goals.filter((g) => g.id !== id) }));
  const trainingDays = profile.trainingDays ?? [];

  // Picking training days also sets sessions per week, so the two never disagree.
  function toggleDay(day) {
    const next = trainingDays.includes(day) ? trainingDays.filter((d) => d !== day) : [...trainingDays, day];
    setSettings((s) => ({ ...s, profile: { ...s.profile, trainingDays: next, daysPerWeek: next.length || s.profile.daysPerWeek } }));
  }

  function addGoal() {
    const exercise = normalizeName(draft.exercise);
    const target = Number(draft.target);
    if (!exercise || !target) return;
    setSettings((s) => ({ ...s, goals: [...s.goals, { id: crypto.randomUUID(), exercise, target, deadline: draft.deadline }] }));
    setDraft({ exercise: "", target: "", deadline: "" });
  }

  return (
    <div className="space-y-4">
      <ViewTitle>Goals</ViewTitle>

      {goals.length > 0 && (
        <p className="-mt-2 text-sm text-zinc-500">Forecasts extend your last 12 weeks of progress. Gains usually slow as you get stronger, so treat dates as rough.</p>
      )}
      {goals.map((goal) => (
        <GoalCard
          key={goal.id}
          goal={goal}
          current={records[goal.exercise]?.e1rm ?? 0}
          forecast={goalForecast(workouts, goal, records[goal.exercise]?.e1rm ?? 0)}
          unit={profile.unit} onRemove={() => removeGoal(goal.id)} />
      ))}

      <Panel className="space-y-3">
        <SectionTitle>New goal</SectionTitle>
        <Field label="Exercise">
          <input list="exercise-names" value={draft.exercise} onChange={(e) => setDraft({ ...draft, exercise: e.target.value })} placeholder="Bench Press" className={inputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={`Target 1RM (${profile.unit})`}>
            <input type="number" inputMode="decimal" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} className={inputClass} />
          </Field>
          <Field label="By (optional)">
            <input type="date" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} className={inputClass} />
          </Field>
        </div>
        <PrimaryButton onClick={addGoal} disabled={!draft.exercise.trim() || !Number(draft.target)}>
          Add goal
        </PrimaryButton>
      </Panel>

      <Panel className="space-y-3">
        <div>
          <SectionTitle>About you</SectionTitle>
          <p className="-mt-1 text-sm text-zinc-500">Your coach uses this to tailor advice.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Your name" className="col-span-2">
            <input value={profile.name ?? ""} onChange={(e) => updateProfile("name")(e.target.value)} placeholder="What your coach calls you" className={inputClass} />
          </Field>
          <Field label="Units">
            <Select value={profile.unit} options={["kg", "lb"]} onChange={updateProfile("unit")} />
          </Field>
          <Field label="Experience">
            <Select value={profile.experience} options={EXPERIENCE_LEVELS} onChange={updateProfile("experience")} />
          </Field>
          <Field label="Sessions per week">
            <input type="number" inputMode="numeric" min="1" max="7" value={profile.daysPerWeek} onChange={(e) => updateProfile("daysPerWeek")(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Main focus" className="col-span-2">
            <Select value={profile.focus} options={TRAINING_FOCUSES} onChange={updateProfile("focus")} />
          </Field>
          <div className="col-span-2">
            <span className="mb-1 block text-sm text-zinc-500">Training days</span>
            <div className="flex gap-1.5">
              {WEEKDAYS.map(({ day, label }) => {
                const on = trainingDays.includes(day);
                return (
                  <button
                    key={day}
                    onClick={() => toggleDay(day)}
                    aria-pressed={on}
                    className={`h-10 flex-1 rounded-lg border text-sm font-semibold ${on ? "border-blue-700 bg-blue-700 text-white" : "border-zinc-300 text-zinc-600"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="Usual time">
            <input type="time" value={profile.trainingTime ?? ""} onChange={(e) => updateProfile("trainingTime")(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Food preferences" className="col-span-2">
            <input
              value={profile.foodNotes ?? ""}
              onChange={(e) => updateProfile("foodNotes")(e.target.value)}
              placeholder="Vegetarian, no dairy, quick meals"
              className={inputClass}
            />
          </Field>
          <Field label="Workout music" className="col-span-2">
            <input value={profile.music ?? ""} onChange={(e) => updateProfile("music")(e.target.value)} placeholder="Rock, hip hop, fast techno" className={inputClass} />
          </Field>
          <Field label="Coaching style" className="col-span-2">
            <Select value={profile.coachStyle ?? DEFAULT_SETTINGS.profile.coachStyle} options={Object.keys(COACH_STYLES)} onChange={updateProfile("coachStyle")} />
          </Field>
          <Field label="Injuries and equipment" className="col-span-2">
            <textarea
              rows={3}
              value={profile.notes}
              onChange={(e) => updateProfile("notes")(e.target.value)}
              placeholder="Home gym with a rack and dumbbells up to 30 kg. Left shoulder gets cranky on overhead work."
              className={inputClass}
            />
            {injuredMuscles(settings).length > 0 && (
              <p className="mt-1 text-sm text-zinc-500">
                Autopilot keeps the weight on lifts that work your {joinWords(injuredMuscles(settings).map((m) => MUSCLE_LABELS[m].toLowerCase()))}.
              </p>
            )}
          </Field>
        </div>
      </Panel>

      <CoachMemoryPanel settings={settings} setSettings={setSettings} />
      <ExportPanel />
      <p className="text-center text-xs text-zinc-400">GymBot {[APP_VERSION, deployedCommit()].filter(Boolean).join(" ")}</p>
    </div>
  );
}

// The facts the coach picked up in chats ([remember: ...] tags), so the athlete can correct or drop them.
function CoachMemoryPanel({ settings, setSettings }) {
  const facts = settings.coachMemory ?? [];
  const update = (index, text) => setSettings((s) => ({ ...s, coachMemory: s.coachMemory.map((f, i) => (i === index ? { ...f, text } : f)) }));
  const remove = (index) => setSettings((s) => ({ ...s, coachMemory: s.coachMemory.filter((_, i) => i !== index) }));
  return (
    <Panel className="space-y-3">
      <div>
        <SectionTitle>What your coach knows</SectionTitle>
        <p className="-mt-1 text-sm text-zinc-500">
          {facts.length ? "Picked up from your chats. Edit or delete anything that's wrong." : "Tell your coach about preferences, injuries or plans and it keeps them here."}
        </p>
      </div>
      {facts.map((fact, i) => (
        <div key={i} className="flex items-center gap-2">
          <input aria-label={`Fact ${i + 1}`} value={fact.text} onChange={(e) => update(i, e.target.value)} className={inputClass} />
          <DeleteButton label={`Delete fact ${i + 1}`} onConfirm={() => remove(i)} />
        </div>
      ))}
    </Panel>
  );
}

// The git commit this copy was deployed from, which the server puts in the page; none in local dev.
export const deployedCommit = () => document.querySelector('meta[name="gymbot-commit"]')?.content;

// Shows the export as text: downloads and clipboard access can be blocked, for example in in-app browsers.
export function ExportPanel() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function exportData() {
    setBusy(true);
    setError("");
    try {
      setText(await exportAllData());
    } catch {
      setError("Couldn't read your data. Try again.");
    }
    setBusy(false);
  }

  function copy() {
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => setError("Copying isn't allowed here. Tap the text, select all and copy it."));
  }

  return (
    <Panel className="space-y-3">
      <div>
        <SectionTitle>Your data</SectionTitle>
        <p className="-mt-1 text-sm text-zinc-500">Everything you've logged, as text you can keep or move to another copy of GymBot.</p>
      </div>
      {text && <textarea readOnly rows={6} value={text} onFocus={(e) => e.target.select()} aria-label="Exported data" className={inputClass} />}
      {text ? <PrimaryButton onClick={copy}>{copied ? "Copied" : "Copy"}</PrimaryButton> : <PrimaryButton onClick={exportData} busy={busy}>Export data</PrimaryButton>}
      <ErrorText message={error} />
    </Panel>
  );
}
