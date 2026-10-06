import { ACTIVITY_EFFORTS, ACTIVITY_TYPES } from "./config.js";
import { daysBetween, pad2, today } from "./dates.js";
import { newId, round1 } from "./training.js";

// An activity: { id, type, minutes, distance (or null), distanceUnit (or null), effort (or null) }.
// It lives in a workout's `activities`, next to (or instead of) gym `exercises`.
export const activityType = (type) => ACTIVITY_TYPES.find((t) => t.type === type) ?? ACTIVITY_TYPES.at(-1);
export const distanceUnitFor = (type, unit) => activityType(type).distance?.[unit] ?? null;
export const activityLabel = (a) => `${a.type} ${a.minutes} min${a.distance ? `, ${a.distance} ${a.distanceUnit}` : ""}`;
export const activityEntry = (date, activities, notes = "") => ({ id: newId(), date, exercises: [], activities, notes });

export function formatPace(minutes) {
  const seconds = Math.round(minutes * 60);
  return `${Math.floor(seconds / 60)}:${pad2(seconds % 60)}`;
}

// Pace the way each sport reads it: running per km/mi, swimming per 100, rowing per 500, cycling as speed.
export function paceText({ type, minutes, distance, distanceUnit }) {
  if (!distance || !minutes) return "";
  switch (activityType(type).pace) {
    case "perUnit":
      return `${formatPace(minutes / distance)} /${distanceUnit}`;
    case "per100":
      return `${formatPace((minutes / distance) * 100)} /100 ${distanceUnit}`;
    case "per500":
      return `${formatPace((minutes / distance) * 500)} /500 ${distanceUnit}`;
    case "speed":
      return `${round1(distance / (minutes / 60))} ${distanceUnit}/h`;
    default:
      return "";
  }
}

export function sanitizeActivities(raw) {
  const units = ["km", "mi", "m", "yd"];
  return (raw?.activities ?? [])
    .map((a) => {
      const type = ACTIVITY_TYPES.find((t) => t.type.toLowerCase() === String(a.type ?? "").toLowerCase())?.type ?? "Other";
      const distance = Number(a.distance) || null;
      const distanceUnit = distance && units.includes(a.distanceUnit) ? a.distanceUnit : null;
      return {
        id: newId(),
        type,
        minutes: Math.round(Number(a.minutes) || 0),
        distance: distanceUnit ? distance : null,
        distanceUnit,
        effort: ACTIVITY_EFFORTS.includes(a.effort) ? a.effort : null,
      };
    })
    .filter((a) => a.minutes > 0);
}

// Per activity type over the last `days` days: { type, count, minutes, distances: { [unit]: total } }, most minutes first.
export function activitySummary(workouts, days = 7) {
  const totals = {};
  for (const workout of workouts.filter((w) => daysBetween(w.date, today()) < days)) {
    for (const a of workout.activities ?? []) {
      if (!totals[a.type]) totals[a.type] = { type: a.type, count: 0, minutes: 0, distances: {} };
      const total = totals[a.type];
      total.count += 1;
      total.minutes += a.minutes;
      if (a.distance) total.distances[a.distanceUnit] = round1((total.distances[a.distanceUnit] ?? 0) + a.distance);
    }
  }
  return Object.values(totals).sort((a, b) => b.minutes - a.minutes);
}

export const summaryText = (s) =>
  [`${s.count} ${s.count === 1 ? "session" : "sessions"}`, `${s.minutes} min`, ...Object.entries(s.distances).map(([unit, d]) => `${d} ${unit}`)].join(", ");
