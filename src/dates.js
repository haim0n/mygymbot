export const toDateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseDate = (key) => new Date(`${key}T00:00:00`);
export const today = () => toDateKey(new Date());
export const daysBetween = (fromKey, toKey) => Math.round((parseDate(toKey) - parseDate(fromKey)) / 86_400_000);
export const formatDate = (key) => parseDate(key).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
export const formatShortDate = (key) => parseDate(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const formatLongDate = (key) => parseDate(key).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
export const pad2 = (n) => String(n).padStart(2, "0");
export const formatClock = (seconds) => `${Math.floor(seconds / 60)}:${pad2(seconds % 60)}`;

export function weekStart(dateKey) {
  const d = parseDate(dateKey);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  return toDateKey(d);
}

export function formatVolume(n) {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

// ["a", "b", "c"] → "a, b and c"
export const joinWords = (words) => (words.length <= 1 ? words[0] ?? "" : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);
