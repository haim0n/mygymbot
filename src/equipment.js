import { EQUIPMENT_ITEMS, PLAN_LOOKBACK_DAYS } from "./config.js";
import { daysBetween } from "./dates.js";
import { equipmentOf } from "./autopilot.js";

// Whether the equipment the athlete has (item ids; null when they haven't said) allows an exercise, read from its name.
// ponytail: bodyweight always passes, as the name can't tell push-ups (nothing needed) from pull-ups (a bar); split it by name if that matters.
export function canDo(name, equipment) {
  if (!equipment) return true;
  const kind = equipmentOf(name);
  return kind === "bodyweight" || EQUIPMENT_ITEMS.some((item) => equipment.includes(item.id) && item.allows.includes(kind));
}

// The items the exercises logged in the last PLAN_LOOKBACK_DAYS need, without the AI: "Hammer Curl (Dumbbell)" gives dumbbell.
export function equipmentFromWorkouts(workouts, todayKey) {
  const kinds = new Set(workouts.filter((w) => daysBetween(w.date, todayKey) <= PLAN_LOOKBACK_DAYS).flatMap((w) => w.exercises.map((e) => equipmentOf(e.name))));
  return EQUIPMENT_ITEMS.filter((item) => item.allows.some((kind) => kinds.has(kind))).map((item) => item.id);
}

// For the coach; null when they haven't said, so the coach doesn't assume a bare room.
export function equipmentContext(profile) {
  const equipment = profile.equipment ?? null;
  if (!equipment) return null;
  if (!equipment.length) return "EQUIPMENT: none, so plan bodyweight exercises only.";
  return `EQUIPMENT (what they can train with; plan only exercises these allow, and bodyweight): ${equipmentNames(equipment, profile.dumbbellMax, profile.unit)}.`;
}

// The coach's profile tag, which copies the EQUIPMENT line: "Dumbbells (up to 20 kg), Bench and pull up bar" → ["dumbbell",
// "bench", "pullUpBar"] (labels or ids; spaces, hyphens and case ignored); "None.", "No equipment", "bodyweight only" → [];
// nothing known → undefined.
export function parseEquipmentList(value) {
  const key = (text) => text.toLowerCase().replace(/[^a-z]/g, "");
  if (/^(none|nothing|noequipment|bodyweight)(yet|atall|only)?$/.test(key(value))) return [];
  const words = value.replace(/\([^)]*\)/g, "").split(/,|\band\b/).map(key); // "Barbell and rack" splits too, and its id still matches
  const ids = EQUIPMENT_ITEMS.filter((item) => words.includes(key(item.label)) || words.includes(key(item.id))).map((item) => item.id);
  return ids.length ? ids : undefined;
}

// "Dumbbells (up to 20 kg), Bench", in list order; "" for no equipment. An unknown id is skipped, so stored data can't break the coach.
export const equipmentNames = (equipment, dumbbellMax, unit) =>
  EQUIPMENT_ITEMS.filter((item) => equipment.includes(item.id))
    .map((item) => (item.id === "dumbbell" && Number(dumbbellMax) > 0 ? `${item.label} (up to ${dumbbellMax} ${unit})` : item.label))
    .join(", ");
