import { useEffect, useRef, createContext, useContext } from "react";
import { X, Info } from "lucide-react";
import { MAX_EXERCISES_PER_CLASSIFICATION, MUSCLE_COLORS, MUSCLE_LABELS, STORAGE_KEYS } from "../config.js";
import { EXERCISE_PHOTO_PROMPT } from "../prompts.js";
import { usePersistentState } from "../storage.js";
import { askAIForJson } from "../ai.js";
import { EXERCISE_PHOTOS } from "../exercise-photos.js";
import { joinWords } from "../dates.js";
import { equipmentOf } from "../autopilot.js";
import { describeMuscles, musclesFor } from "../muscles.js";
import { PrimaryButton } from "./primitives.jsx";
import { BodyFigure, BodyView, exerciseFills } from "./muscles.jsx";
import { VideoGuides } from "./videos.jsx";
import { guideFor, photoFor, samePhoto } from "../training.js";

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

// Asks the AI once which photo shows each exercise without a same-named one, and keeps the answer (null: none fits).
export function useLearnedPhotos({ enabled, exerciseNames }) {
  const [learned, setLearned, learnedLoaded] = usePersistentState(STORAGE_KEYS.exercisePhotos, {});
  const requestedKey = useRef(null);
  const unknown = exerciseNames.filter((name) => !samePhoto(name) && !(name in learned)).slice(0, MAX_EXERCISES_PER_CLASSIFICATION);
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

export function ExerciseSheet({ name, onClose }) {
  const { learnedMuscles, learnedPhotos } = useContext(ExerciseContext);
  const muscles = musclesFor(name, learnedMuscles);
  const photo = photoFor(name, learnedPhotos);
  const guide = guideFor(name);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose; // the parent re-renders often (e.g. the rest timer); this keeps the setup below to once

  // Keep the page behind still, start keyboard focus on Close, and let Escape close it.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event) => event.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const labels = (list) => {
    const text = joinWords(list.map((m) => MUSCLE_LABELS[m].toLowerCase()));
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.45)" }} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="exercise-sheet-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 pb-8"
        style={{ maxHeight: "88vh" }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="exercise-sheet-title" className="gb-display text-3xl font-bold leading-tight text-zinc-900">
            {name}
          </h2>
          <button ref={closeRef} onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-zinc-500">
            <X className="w-6 h-6" />
          </button>
        </div>

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
      </div>
    </div>
  );
}
