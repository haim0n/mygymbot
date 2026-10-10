import { useEffect, useRef, useState, createContext, useContext } from "react";
import { X, Info, Plus, Search } from "lucide-react";
import { MAX_EXERCISES_PER_CLASSIFICATION, MUSCLES, MUSCLE_COLORS, MUSCLE_LABELS, STORAGE_KEYS } from "../config.js";
import { EXERCISE_PHOTO_PROMPT } from "../prompts.js";
import { usePersistentState } from "../storage.js";
import { askAIForJson } from "../ai.js";
import { EXERCISE_PHOTOS } from "../exercise-photos.js";
import { joinWords } from "../dates.js";
import { equipmentOf } from "../autopilot.js";
import { describeMuscles, musclesFor } from "../muscles.js";
import { PrimaryButton, inputClass } from "./primitives.jsx";
import { BodyFigure, BodyView, exerciseFills } from "./muscles.jsx";
import { VideoGuides } from "./videos.jsx";
import { guideFor, knownPhoto, normalizeName, photoFor, searchExercises } from "../training.js";

// Where each muscle sits on the figure: which view shows it best, and a box (figure units, both sides)
// that thumbnails zoom into, so the target muscle fills a small tile.
export const MUSCLE_FOCUS = {
  chest: { view: "front", box: [34, 33, 66, 52] },
  shoulders: { view: "front", box: [24, 30, 76, 46] },
  biceps: { view: "front", box: [22, 45, 78, 65] },
  forearms: { view: "front", box: [19, 66, 81, 88] },
  core: { view: "front", box: [41, 53, 59, 85] },
  quads: { view: "front", box: [34, 101, 66, 139] },
  traps: { view: "back", box: [37, 24, 63, 46] },
  upperBack: { view: "back", box: [37, 38, 63, 54] },
  lats: { view: "back", box: [32, 46, 68, 73] },
  lowerBack: { view: "back", box: [43, 74, 57, 87] },
  triceps: { view: "back", box: [22, 45, 78, 65] },
  glutes: { view: "back", box: [35, 87, 65, 105] },
  hamstrings: { view: "back", box: [34, 106, 66, 139] },
  calves: { view: "back", box: [36, 150, 64, 178] },
};
export const THUMB_PADDING = 8; // figure units around the target muscles
export const THUMB_MIN_SPAN = 48; // never zoom in so far that the body stops reading as a body

export const EQUIPMENT_LABELS = {
  barbell: "Barbell", bigBarbell: "Barbell", dumbbell: "Dumbbells", kettlebell: "Kettlebell", cable: "Cable", machine: "Machine", bodyweight: "Bodyweight",
};

// The view and square crop that show an exercise's main muscles; the whole figure if they're unknown.
export function thumbnailFrame(muscles) {
  const focus = (muscles?.primary ?? []).map((m) => MUSCLE_FOCUS[m]).filter(Boolean);
  if (!focus.length) return { view: "front", viewBox: "-50 0 200 200" };
  const view = focus[0].view;
  const boxes = focus.filter((f) => f.view === view).map((f) => f.box);
  const [x1, y1] = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1]))];
  const [x2, y2] = [Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
  const span = Math.max(x2 - x1, y2 - y1, THUMB_MIN_SPAN - 2 * THUMB_PADDING) + 2 * THUMB_PADDING;
  return { view, viewBox: `${(x1 + x2 - span) / 2} ${(y1 + y2 - span) / 2} ${span} ${span}` };
}

// Asks the AI once which photo shows each exercise the app doesn't know a photo for, and keeps the answer (null: none fits).
export function useLearnedPhotos({ enabled, exerciseNames }) {
  const [learned, setLearned, learnedLoaded] = usePersistentState(STORAGE_KEYS.exercisePhotos, {});
  const requestedKey = useRef(null);
  const unknown = exerciseNames.filter((name) => knownPhoto(name) === undefined && !(name in learned)).slice(0, MAX_EXERCISES_PER_CLASSIFICATION);
  const key = unknown.join("|");

  useEffect(() => {
    if (!enabled || !learnedLoaded || !unknown.length || requestedKey.current === key) return;
    requestedKey.current = key;
    askAIForJson(EXERCISE_PHOTO_PROMPT, unknown.join("\n"))
      .then((result) => {
        const byName = Object.fromEntries(Object.entries(result).map(([name, id]) => [name.toLowerCase(), id]));
        const matched = unknown.map((name) => [name, EXERCISE_PHOTOS.includes(byName[name.toLowerCase()]) ? byName[name.toLowerCase()] : null]);
        setLearned((current) => ({ ...current, ...Object.fromEntries(matched) }));
      })
      .catch(() => {}); // asked again next time; meanwhile the muscle figure shows
  }, [enabled, learnedLoaded, key]);

  return learned;
}

// Muscle and photo lookups and the details sheet are needed in many places, so they're shared instead of passed down.
export const ExerciseContext = createContext({ learnedMuscles: {}, learnedPhotos: {}, showDetails: () => {} });

// Small tile showing the exercise being done, so the equipment is easy to find; without a photo, zoomed in
// on the target muscles (red = main, light red = helpers). Tap for details.
export function ExerciseThumb({ name, size = 52, interactive = true }) {
  const { learnedMuscles, learnedPhotos, showDetails } = useContext(ExerciseContext);
  const muscles = musclesFor(name, learnedMuscles);
  const photo = photoFor(name, learnedPhotos);
  const frame = thumbnailFrame(muscles);
  const tile = "relative shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-white";
  const picture = photo ? (
    <img src={`/exercises/${photo}-0.webp`} alt="" loading="lazy" className="h-full w-full object-cover" />
  ) : (
    <svg viewBox={frame.viewBox} width={size} height={size} aria-hidden="true">
      <BodyView side={frame.view} fills={exerciseFills(muscles)} />
    </svg>
  );
  if (!interactive) return <span className={tile} style={{ width: size, height: size }}>{picture}</span>;
  return (
    <button onClick={() => showDetails(name)} aria-label={`Show details for ${name}`} className={tile} style={{ width: size, height: size }}>
      {picture}
      <Info className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-white text-zinc-400" />
    </button>
  );
}

// A sheet that slides over the app from the bottom. The page behind stays still, Escape closes it, and keyboard
// focus starts on Close unless a field inside asked for it.
export function BottomSheet({ title, onClose, fullHeight = false, children }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose; // the parent re-renders often (e.g. the rest timer); this keeps the setup below to once

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialogRef.current.contains(document.activeElement)) closeRef.current.focus();
    const onKey = (event) => event.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    // margin 0: a parent's space-y would push the backdrop down
    <div className="fixed inset-0 z-20 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.45)", margin: 0 }} onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 pb-8"
        style={fullHeight ? { height: "88vh" } : { maxHeight: "88vh" }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="sheet-title" className="gb-display text-3xl font-bold leading-tight text-zinc-900">
            {title}
          </h2>
          <button ref={closeRef} onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-zinc-500">
            <X className="w-6 h-6" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ExerciseSheet({ name, onClose }) {
  const { learnedMuscles, learnedPhotos } = useContext(ExerciseContext);
  const muscles = musclesFor(name, learnedMuscles);
  const photo = photoFor(name, learnedPhotos);
  const guide = guideFor(name);

  const labels = (list) => {
    const text = joinWords(list.map((m) => MUSCLE_LABELS[m].toLowerCase()));
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  return (
    <BottomSheet title={name} onClose={onClose}>
      {photo && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <img src={`/exercises/${photo}-0.webp`} alt={`${name}: start`} className="w-full rounded-xl" />
          <img src={`/exercises/${photo}-1.webp`} alt={`${name}: finish`} className="w-full rounded-xl" />
        </div>
      )}

      <div className="my-4 flex justify-center rounded-2xl bg-zinc-50 py-3">
        <BodyFigure
          fills={exerciseFills(muscles)}
          height={260}
          showSides
          label={muscles ? `Works ${describeMuscles(muscles).toLowerCase()}` : "Muscles not known yet"}
        />
      </div>

      <dl className="space-y-2 text-zinc-700">
        <div className="flex gap-3">
          <dt className="w-24 shrink-0 font-semibold text-zinc-900">Main</dt>
          <dd className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: MUSCLE_COLORS.primary }} />
            {muscles?.primary.length ? labels(muscles.primary) : "Not known yet"}
          </dd>
        </div>
        {muscles?.secondary.length > 0 && (
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-semibold text-zinc-900">Helpers</dt>
            <dd className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: MUSCLE_COLORS.secondary }} />
              {labels(muscles.secondary)}
            </dd>
          </div>
        )}
        <div className="flex gap-3">
          <dt className="w-24 shrink-0 font-semibold text-zinc-900">Equipment</dt>
          <dd>{EQUIPMENT_LABELS[equipmentOf(name)]}</dd>
        </div>
      </dl>

      {guide && <VideoGuides guide={guide} />}

      <div className="mt-4">
        <PrimaryButton onClick={onClose}>Done</PrimaryButton>
      </div>
    </BottomSheet>
  );
}

// Find an exercise by name or by muscle, to add it or to swap one for it. Replacing starts on the old exercise's main muscle,
// so the alternatives show without typing.
export function ExercisePicker({ yourNames, replacing, onPick, onClose }) {
  const { learnedMuscles } = useContext(ExerciseContext);
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState(() => (replacing && musclesFor(replacing, learnedMuscles)?.primary[0]) || null);
  const [muscleTapped, setMuscleTapped] = useState(false);
  const selectedChip = useRef(null);
  const names = searchExercises(query, yourNames, { muscle, learnedMuscles }).filter((name) => name !== replacing);
  const typed = normalizeName(query);
  const chip = "shrink-0 rounded-full px-3 py-2.5 text-sm font-semibold";

  useEffect(() => {
    selectedChip.current?.scrollIntoView({ inline: "center", block: "nearest" }); // newer browsers return a promise, which React would call on close
  }, []);

  // The muscle Replace starts on is a suggestion: typing searches every muscle, unless you tapped one.
  function search(text) {
    setQuery(text);
    if (!muscleTapped) setMuscle(null);
  }

  // Enter picks the top row, or the name as typed when nothing is listed.
  function pickFirst(event) {
    event.preventDefault();
    if (names[0] ?? typed) onPick(names[0] ?? typed);
  }

  return (
    <BottomSheet title={replacing ? "Replace" : "Add an exercise"} onClose={onClose} fullHeight>
      {replacing && <p className="text-sm text-zinc-500">Instead of {replacing}</p>}
      <div className="sticky -top-5 z-10 -mx-5 space-y-2 bg-white px-5 pb-2 pt-3">
        <form onSubmit={pickFirst} className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-zinc-400" />
          <input
            type="search"
            enterKeyHint="done"
            value={query}
            onChange={(e) => search(e.target.value)}
            autoFocus={!replacing}
            placeholder="Search exercises"
            aria-label="Search exercises"
            className={`${inputClass} pl-10`}
          />
        </form>
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 py-1" role="group" aria-label="Main muscle">
          {MUSCLES.map((m) => (
            <button
              key={m}
              ref={m === muscle ? selectedChip : null}
              onClick={() => {
                setMuscle(m === muscle ? null : m);
                setMuscleTapped(true);
              }}
              aria-pressed={m === muscle}
              className={`${chip} ${m === muscle ? "bg-blue-700 text-white" : "bg-zinc-100 text-zinc-700 active:bg-zinc-200"}`}
            >
              {MUSCLE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>
      <ul className="divide-y divide-zinc-200">
        {names.map((name) => {
          const muscles = !muscle && musclesFor(name, learnedMuscles); // with a muscle chosen, every row would say it
          return (
            <li key={name}>
              <button onClick={() => onPick(name)} className="flex w-full items-center gap-3 py-2 text-left active:bg-zinc-50">
                <ExerciseThumb name={name} size={44} interactive={false} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-zinc-900">{name}</span>
                  {muscles && <span className="block text-sm text-zinc-500">{describeMuscles({ primary: muscles.primary, secondary: [] })}</span>}
                </span>
              </button>
            </li>
          );
        })}
        {typed && !names.length && (
          <li>
            <button onClick={() => onPick(typed)} className="flex w-full items-center gap-3 py-3 text-left font-semibold text-blue-700 active:bg-zinc-50">
              <Plus className="h-5 w-5" />
              Add &ldquo;{typed}&rdquo;
            </button>
          </li>
        )}
      </ul>
    </BottomSheet>
  );
}
