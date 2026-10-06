import { useEffect, useRef } from "react";
import { INJURY_READ_DELAY_MS, MAX_EXERCISES_PER_CLASSIFICATION, MUSCLES, MUSCLE_COLORS, MUSCLE_LABELS, STORAGE_KEYS, VOLUME_LEVELS } from "../config.js";
import { INJURY_AREAS_PROMPT, MUSCLE_CLASSIFIER_PROMPT } from "../prompts.js";
import { usePersistentState } from "../storage.js";
import { askAIForJson } from "../ai.js";
import { joinWords } from "../dates.js";
import { formatSets, ruleMuscles, sanitizeMuscles, volumeColor, weeklyMuscleSets } from "../muscles.js";
import { Panel, SectionTitle } from "./primitives.jsx";

// An original, stylised front and back figure. Shapes are drawn for the left half (centre line x = 50)
// and mirrored; `center` shapes sit on the centre line and are drawn once.
export const BODY_VIEWS = {
  front: {
    body: [
      { tag: "circle", center: true, attrs: { cx: 50, cy: 13, r: 9 } },
      { tag: "rect", center: true, attrs: { x: 46, y: 21, width: 8, height: 7, rx: 2 } },
      { tag: "path", center: true, attrs: { d: "M39 87 L61 87 L59 97 L50 101 L41 97 Z" } },
      { tag: "circle", attrs: { cx: 20.5, cy: 93, r: 4 } },
      { tag: "ellipse", attrs: { cx: 43, cy: 145, rx: 4.5, ry: 5 } },
      { tag: "ellipse", attrs: { cx: 42, cy: 190, rx: 6, ry: 3.5 } },
    ],
    muscles: [
      { id: "traps", tag: "path", attrs: { d: "M45 26 L47 31 L37 32 Z" } },
      { id: "shoulders", tag: "ellipse", attrs: { cx: 31, cy: 38, rx: 7, ry: 8 } },
      { id: "chest", tag: "path", attrs: { d: "M49 34 L39 33 Q34 38 36 47 Q42 52 49 50 Z" } },
      { id: "biceps", tag: "ellipse", attrs: { cx: 27, cy: 55, rx: 4.5, ry: 10 } },
      { id: "forearms", tag: "path", attrs: { d: "M23 66 L29 66 L25 88 L19 87 Z" } },
      { id: "core", tag: "rect", center: true, attrs: { x: 41, y: 53, width: 18, height: 32, rx: 5 } },
      { id: "quads", tag: "path", attrs: { d: "M38 101 Q34 118 38 139 L47 139 Q50 120 48 102 Z" } },
      { id: "calves", tag: "ellipse", attrs: { cx: 42, cy: 167, rx: 4.5, ry: 16 } },
    ],
  },
  back: {
    body: [
      { tag: "circle", center: true, attrs: { cx: 50, cy: 13, r: 9 } },
      { tag: "rect", center: true, attrs: { x: 46, y: 21, width: 8, height: 7, rx: 2 } },
      { tag: "circle", attrs: { cx: 20.5, cy: 93, r: 4 } },
      { tag: "ellipse", attrs: { cx: 43, cy: 145, rx: 4.5, ry: 5 } },
      { tag: "ellipse", attrs: { cx: 42, cy: 190, rx: 6, ry: 3.5 } },
    ],
    muscles: [
      { id: "traps", tag: "path", attrs: { d: "M50 24 L37 32 L50 46 Z" } },
      { id: "shoulders", tag: "ellipse", attrs: { cx: 31, cy: 38, rx: 7, ry: 8 } },
      { id: "upperBack", tag: "path", attrs: { d: "M49 47 L41 38 L37 43 L41 53 L49 54 Z" } },
      { id: "lats", tag: "path", attrs: { d: "M37 46 Q32 58 40 73 L48 72 L48 62 Q44 58 41 55 Z" } },
      { id: "lowerBack", tag: "rect", center: true, attrs: { x: 43.5, y: 74, width: 13, height: 13, rx: 3 } },
      { id: "triceps", tag: "ellipse", attrs: { cx: 27, cy: 55, rx: 4.5, ry: 10 } },
      { id: "forearms", tag: "path", attrs: { d: "M23 66 L29 66 L25 88 L19 87 Z" } },
      { id: "glutes", tag: "ellipse", attrs: { cx: 43, cy: 96, rx: 7.5, ry: 8.5 } },
      { id: "hamstrings", tag: "path", attrs: { d: "M37 106 Q34 124 38 139 L47 139 Q50 122 49 106 Z" } },
      { id: "calves", tag: "ellipse", attrs: { cx: 42, cy: 164, rx: 5.5, ry: 14 } },
    ],
  },
};

export const MIRROR = "matrix(-1 0 0 1 100 0)"; // reflect across the centre line

export function BodyShape({ shape, fill }) {
  const Tag = shape.tag;
  const element = <Tag {...shape.attrs} fill={fill} />;
  if (shape.center) return element;
  return (
    <>
      {element}
      <g transform={MIRROR}>{element}</g>
    </>
  );
}

// One side of the figure. `fills` maps muscle id → colour; other muscles stay grey.
export function BodyView({ side, fills }) {
  return (
    <>
      {BODY_VIEWS[side].body.map((shape, j) => (
        <BodyShape key={j} shape={shape} fill={MUSCLE_COLORS.body} />
      ))}
      {BODY_VIEWS[side].muscles.map((shape) => (
        <BodyShape key={shape.id} shape={shape} fill={fills[shape.id] ?? MUSCLE_COLORS.idle} />
      ))}
    </>
  );
}

// Front and back side by side.
export function BodyFigure({ fills, height, label, showSides = false }) {
  return (
    <svg viewBox={`0 0 200 ${showSides ? 214 : 200}`} height={height} role="img" aria-label={label} className="shrink-0">
      {["front", "back"].map((side, i) => (
        <g key={side} transform={`translate(${i * 100} 0)`}>
          <BodyView side={side} fills={fills} />
          {showSides && (
            <text x="50" y="211" textAnchor="middle" fontSize="11" fill="#71717a">
              {side === "front" ? "Front" : "Back"}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export function exerciseFills(muscles) {
  if (!muscles) return {};
  return {
    ...Object.fromEntries(muscles.secondary.map((m) => [m, MUSCLE_COLORS.secondary])),
    ...Object.fromEntries(muscles.primary.map((m) => [m, MUSCLE_COLORS.primary])),
  };
}

// Exercises the rules don't recognise are classified by the coach in batches, once, and remembered.
export function useLearnedMuscles({ enabled, exerciseNames }) {
  const [learned, setLearned, learnedLoaded] = usePersistentState(STORAGE_KEYS.muscleMap, {});
  const requestedKey = useRef(null);
  const unknown = exerciseNames.filter((name) => !ruleMuscles(name) && !learned[name]).slice(0, MAX_EXERCISES_PER_CLASSIFICATION);
  const key = unknown.join("|");

  useEffect(() => {
    if (!enabled || !learnedLoaded || !unknown.length || requestedKey.current === key) return;
    requestedKey.current = key;
    askAIForJson(MUSCLE_CLASSIFIER_PROMPT, unknown.join("\n"))
      .then((result) => {
        const byName = Object.fromEntries(Object.entries(result).map(([name, muscles]) => [name.toLowerCase(), muscles]));
        const classified = unknown.filter((name) => byName[name.toLowerCase()]).map((name) => [name, sanitizeMuscles(byName[name.toLowerCase()])]);
        setLearned((current) => ({ ...current, ...Object.fromEntries(classified) }));
      })
      .catch(() => {}); // unclassified exercises just show a grey figure
  }, [enabled, learnedLoaded, key]);

  return learned;
}

// Reads the profile's injury note into muscles once per version of the note, for Autopilot to go easy on.
export function useInjuryAreas({ enabled, settings, setSettings }) {
  const notes = (settings.profile.notes ?? "").trim();
  const isRead = settings.injuryAreas?.notes === notes;
  const requestedNotes = useRef(null);

  useEffect(() => {
    if (!enabled || !notes || isRead || requestedNotes.current === notes) return; // an empty note holds nothing (see injuredMuscles)
    const timer = setTimeout(() => {
      requestedNotes.current = notes;
      askAIForJson(INJURY_AREAS_PROMPT, notes)
        .then((result) => setSettings((s) => ({ ...s, injuryAreas: { notes, muscles: sanitizeMuscles({ primary: result.muscles }).primary } })))
        .catch(() => {}); // the coach still reads the note; Autopilot just doesn't hold anything
    }, INJURY_READ_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, isRead, notes]);
}

export function MuscleHeatmap({ workouts, learned }) {
  const sets = weeklyMuscleSets(workouts, learned);
  const fills = Object.fromEntries(MUSCLES.map((m) => [m, volumeColor(sets[m])]));
  const trained = MUSCLES.filter((m) => sets[m] > 0).sort((a, b) => sets[b] - sets[a]);
  const untrained = MUSCLES.filter((m) => sets[m] === 0);

  return (
    <Panel>
      <SectionTitle>Muscles, last 7 days</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-zinc-500">Sets per muscle. A set counts fully for the main muscle and half for helpers.</p>
      <div className="flex justify-center">
        <BodyFigure fills={fills} height={230} showSides label="Muscles trained in the last 7 days" />
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-3 text-xs text-zinc-500">
        {[...VOLUME_LEVELS].reverse().map((level) => (
          <span key={level.label} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: level.color }} />
            {level.label}
          </span>
        ))}
      </div>
      {trained.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {trained.map((m) => (
            <li key={m} className="flex justify-between">
              <span className="text-zinc-700">{MUSCLE_LABELS[m]}</span>
              <span className="tabular-nums text-zinc-500">{formatSets(sets[m])}</span>
            </li>
          ))}
        </ul>
      )}
      {untrained.length > 0 && (
        <p className="mt-3 text-sm text-zinc-500">Not trained: {joinWords(untrained.map((m) => MUSCLE_LABELS[m].toLowerCase()))}.</p>
      )}
    </Panel>
  );
}
