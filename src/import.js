import Papa from "papaparse";
import { COLUMN_ALIASES, MAX_IMPORT_SCREENSHOTS } from "./config.js";
import { COLUMN_MAPPER_PROMPT, SCREENSHOT_IMPORT_PROMPT } from "./prompts.js";
import { askAIForJson } from "./ai.js";
import { screenshotToTiles } from "./media.js";
import { pad2, toDateKey, today } from "./dates.js";
import { cleanExerciseName, sanitizeExercises } from "./training.js";
import { roundTo } from "./autopilot.js";

export const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export const parseNumber = (value) => Number(String(value ?? "").replace(",", ".")) || 0;

// Handles "2024-08-21 18:05:00" (Strong), "21 Aug 2024, 18:05" (Hevy) and anything else the browser can parse.
export function dateKeyFromText(value) {
  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;
  const dayFirst = text.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})/i);
  const month = dayFirst && MONTHS.indexOf(dayFirst[2].toLowerCase());
  if (dayFirst && month >= 0) return `${dayFirst[3]}-${pad2(month + 1)}-${pad2(dayFirst[1])}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : toDateKey(parsed);
}

export function convertWeight(weight, fromUnit, toUnit) {
  if (fromUnit === toUnit) return weight;
  return roundTo(fromUnit === "lb" ? weight * 0.453592 : weight * 2.20462, 0.5);
}

// A row's weight unit: from the column name ("weight_lbs"), a per-row unit column, or the athlete's default.
export function rowUnit(row, columns, fallbackUnit) {
  const hint = `${columns.weight ?? ""} ${columns.weightUnit ? row[columns.weightUnit] : ""}`.toLowerCase();
  if (hint.includes("lb")) return "lb";
  if (hint.includes("kg")) return "kg";
  return fallbackUnit;
}

export function detectColumns(headers) {
  const find = (aliases) => headers.find((header) => aliases.includes(header.toLowerCase())) ?? null;
  return Object.fromEntries(Object.entries(COLUMN_ALIASES).map(([field, aliases]) => [field, find(aliases)]));
}

export const hasRequiredColumns = (columns) => Boolean(columns.date && columns.exercise && columns.reps);

// Unknown layout: the AI only maps the columns; parsing stays local and deterministic.
export async function mapColumnsWithAI(headers, rows) {
  const sample = [headers, ...rows.slice(0, 5).map((row) => headers.map((h) => row[h]))].map((cells) => cells.join(",")).join("\n");
  const mapping = await askAIForJson(COLUMN_MAPPER_PROMPT, sample);
  return Object.fromEntries(Object.keys(COLUMN_ALIASES).map((field) => [field, headers.includes(mapping[field]) ? mapping[field] : null]));
}

// One row per set in, one workout per day out (same-day sessions are merged).
export function rowsToWorkouts(rows, columns, unit) {
  const days = new Map(); // date -> Map(exercise name -> sets)
  let skipped = 0;
  for (const row of rows) {
    const date = dateKeyFromText(row[columns.date]);
    const name = cleanExerciseName(row[columns.exercise]);
    const reps = Math.round(parseNumber(row[columns.reps]));
    const isWarmup = columns.setType && /warm/i.test(row[columns.setType] ?? "");
    if (!date || !name || reps <= 0 || isWarmup) {
      skipped++;
      continue;
    }
    const weight = convertWeight(parseNumber(columns.weight ? row[columns.weight] : 0), rowUnit(row, columns, unit), unit);
    if (!days.has(date)) days.set(date, new Map());
    const exercises = days.get(date);
    exercises.set(name, [...(exercises.get(name) ?? []), { reps, weight }]);
  }
  const workouts = [...days].map(([date, exercises]) => ({
    date,
    exercises: [...exercises].map(([name, sets]) => ({ name, sets })),
    notes: "",
    source: "import",
  }));
  return { workouts, skipped };
}

export async function workoutsFromCsv(text, unit) {
  const { data: rows, meta } = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
  });
  const headers = meta.fields ?? [];
  let columns = detectColumns(headers);
  if (!hasRequiredColumns(columns)) columns = await mapColumnsWithAI(headers, rows);
  if (!hasRequiredColumns(columns)) throw new Error("Couldn't find date, exercise and reps columns in this file.");
  return rowsToWorkouts(rows, columns, unit);
}

export const toSet = (set) => (Array.isArray(set) ? { weight: set[0], reps: set[1] } : set); // [weight, reps] or {weight, reps}

export async function workoutsFromScreenshot(file, unit) {
  const tiles = await screenshotToTiles(file);
  const instructions = [
    tiles.length > 1 && `These ${tiles.length} images are consecutive slices of one long screenshot, top to bottom, overlapping slightly. Count each set once.`,
    `Today is ${today()}. Give weights in ${unit}, converting if the app shows the other unit.`,
  ];
  const parsed = await askAIForJson(SCREENSHOT_IMPORT_PROMPT, instructions.filter(Boolean).join("\n"), tiles);
  return (parsed.workouts ?? [])
    .map((w) => ({
      date: dateKeyFromText(w.date),
      exercises: sanitizeExercises({ exercises: (w.exercises ?? []).map((e) => ({ name: e.name, sets: (e.sets ?? []).map(toSet) })) }),
      notes: "",
      source: "import",
    }))
    .filter((w) => w.date && w.exercises.length);
}

export function mergeSameDay(workouts) {
  const byDate = new Map();
  for (const w of workouts) {
    const sameDay = byDate.get(w.date);
    byDate.set(w.date, sameDay ? { ...sameDay, exercises: [...sameDay.exercises, ...w.exercises] } : w);
  }
  return [...byDate.values()];
}

export async function workoutsFromScreenshots(files, unit) {
  const perScreenshot = await Promise.all(files.map((file) => workoutsFromScreenshot(file, unit)));
  return { workouts: mergeSameDay(perScreenshot.flat()), skipped: 0 };
}

// Android often labels CSVs "text/comma-separated-values" or "application/vnd.ms-excel", so check loosely.
export const looksLikeCsv = (file) => /\.(csv|txt)$/i.test(file.name) || /csv|text|excel/i.test(file.type);

export async function readImportFiles(files, unit) {
  const csv = files.find(looksLikeCsv);
  if (csv) return workoutsFromCsv(await csv.text(), unit);
  const images = files.filter((file) => file.type.startsWith("image/")).slice(0, MAX_IMPORT_SCREENSHOTS);
  if (images.length) return workoutsFromScreenshots(images, unit);
  throw new Error("Choose a CSV export or screenshots of your workouts.");
}

export const workoutFingerprint = (w) =>
  `${w.date}|${w.exercises.map((e) => `${e.name}:${e.sets.map((s) => `${s.weight}x${s.reps}`).join(",")}`).join(";")}`;

export function withoutDuplicates(incoming, existing) {
  const known = new Set(existing.map(workoutFingerprint));
  return incoming.filter((w) => !known.has(workoutFingerprint(w)));
}
