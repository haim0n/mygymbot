import { useState } from "react";
import { formatLongDate } from "../dates.js";
import { exercisesByFrequency, sortOldestFirst } from "../training.js";
import { readImportFiles, withoutDuplicates, workoutsFromCsv } from "../import.js";
import { ErrorText, FilePicker, Panel, PrimaryButton, SectionTitle, inputClass } from "./primitives.jsx";

export function ImportPanel({ workouts, setWorkouts, unit }) {
  const [preview, setPreview] = useState(null); // { workouts, duplicates, skipped }
  const [importedCount, setImportedCount] = useState(0);
  const [pastedCsv, setPastedCsv] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");

  // Shared by both entry points: `read` returns { workouts, skipped }.
  async function loadPreview(read) {
    setReading(true);
    setError("");
    setPreview(null);
    setImportedCount(0);
    try {
      const { workouts: found, skipped } = await read();
      if (!found.length) throw new Error("No sets with reps found. Check that this is a workout export.");
      const fresh = withoutDuplicates(found, workouts);
      setPreview({ workouts: sortOldestFirst(fresh), duplicates: found.length - fresh.length, skipped });
    } catch (err) {
      setError(err instanceof SyntaxError ? "Couldn't read a workout from that. Try a sharper screenshot or one workout per screenshot." : err.message);
    } finally {
      setReading(false);
    }
  }

  const importFiles = (files) => loadPreview(() => readImportFiles(files, unit));
  const importPasted = () => loadPreview(() => workoutsFromCsv(pastedCsv, unit));

  function confirmImport() {
    setWorkouts((all) => [...all, ...preview.workouts.map((w) => ({ ...w, id: crypto.randomUUID() }))]);
    setImportedCount(preview.workouts.length);
    setPreview(null);
    setPastedCsv("");
  }

  return (
    <Panel className="space-y-3">
      <div>
        <SectionTitle>Import history</SectionTitle>
        <p className="-mt-1 text-sm text-zinc-500">
          Export a CSV from Strong, Hevy or most other lifting apps and choose it here. No export option? Upload screenshots of your history instead.
        </p>
      </div>

      <FilePicker busy={reading} title={reading ? "Reading your history" : "Choose a CSV or screenshots"} onFiles={importFiles} />

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-blue-700">Can't pick a file? Paste the CSV text instead</summary>
        <div className="mt-2 space-y-2">
          <textarea
            rows={5}
            value={pastedCsv}
            onChange={(e) => setPastedCsv(e.target.value)}
            placeholder="Date,Workout Name,Exercise Name,Set Order,Weight,Reps…"
            className={inputClass}
          />
          <PrimaryButton onClick={importPasted} busy={reading} disabled={!pastedCsv.trim()}>
            Read pasted CSV
          </PrimaryButton>
        </div>
      </details>

      <ErrorText message={error} />
      {preview && <ImportPreview preview={preview} onConfirm={confirmImport} />}
      {importedCount > 0 && (
        <p className="text-sm font-semibold text-green-700">Imported {importedCount} workouts. Your charts and targets now include them.</p>
      )}
      <p className="text-xs text-zinc-500">
        CSV files are read on your phone. Screenshots, and the first 5 rows of a CSV layout GymBot doesn't recognise, are sent to the coach to read.
      </p>
    </Panel>
  );
}

export function ImportPreview({ preview, onConfirm }) {
  const { workouts, duplicates, skipped } = preview;
  const names = exercisesByFrequency(workouts);
  const shownNames = 8;

  return (
    <div className="space-y-2 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-700">
      {workouts.length > 0 ? (
        <p>
          <span className="font-semibold text-zinc-900">{workouts.length} new workouts</span> from {formatLongDate(workouts[0].date)} to{" "}
          {formatLongDate(workouts.at(-1).date)}.
        </p>
      ) : (
        <p className="font-semibold text-zinc-900">Everything in this file is already in your log.</p>
      )}
      {duplicates > 0 && <p>{duplicates} workouts already in your log will be skipped.</p>}
      {skipped > 0 && <p>{skipped} rows skipped: warm-up sets, cardio or unreadable rows.</p>}
      {names.length > 0 && (
        <p>
          Exercises: {names.slice(0, shownNames).join(", ")}
          {names.length > shownNames ? ` and ${names.length - shownNames} more` : ""}.
        </p>
      )}
      {workouts.length > 0 && <PrimaryButton onClick={onConfirm}>Import {workouts.length} workouts</PrimaryButton>}
    </div>
  );
}
