import { MAX_FOOD_GRAMS, MAX_PER_100G, MAX_USUAL_MEALS, PROTEIN_PER_KG, USUAL_MEAL_MIN_COUNT } from "./config.js";
import { parseDate, toDateKey } from "./dates.js";

const NUTRIENTS = ["protein", "carbs", "fat", "kcal"];
const sum = (list) => Object.fromEntries(NUTRIENTS.map((n) => [n, list.reduce((total, values) => total + values[n], 0)]));

// Grams may be a string while typed.
export const itemTotals = (item) => Object.fromEntries(NUTRIENTS.map((n) => [n, (item.per100[n] * (Number(item.grams) || 0)) / 100]));
export const mealTotals = (meal) => sum(meal.items.map(itemTotals));
export const mealsOn = (food, date) => food.filter((meal) => meal.date === date);
export const dayTotals = (food, date) => sum(mealsOn(food, date).map(mealTotals));

// The daily protein range from bodyweight (in the profile's unit); null without a bodyweight.
export function proteinTarget(bodyweight, unit) {
  if (!bodyweight) return null;
  const kg = unit === "lb" ? bodyweight * 0.4536 : bodyweight;
  const [low, high] = PROTEIN_PER_KG.map((perKg) => Math.round(kg * perKg));
  return { low, high };
}

// Protein per day for the `days` days up to `endDate`, oldest first, 0 for a day with nothing logged.
export function dailyProtein(food, endDate, days) {
  return Array.from({ length: days }, (_, i) => {
    const d = parseDate(endDate);
    d.setDate(d.getDate() - (days - 1 - i));
    const date = toDateKey(d);
    return { date, protein: dayTotals(food, date).protein };
  });
}

// Meals logged USUAL_MEAL_MIN_COUNT times or more (same foods, any amounts), most frequent first, each as its latest version.
export function usualMeals(food) {
  const groups = new Map();
  for (const meal of food) {
    const key = meal.items.map((item) => item.name.toLowerCase()).sort().join("|");
    const group = groups.get(key) ?? { count: 0, latest: meal };
    groups.set(key, { count: group.count + 1, latest: `${meal.date} ${meal.time}` >= `${group.latest.date} ${group.latest.time}` ? meal : group.latest });
  }
  return [...groups.values()]
    .filter((group) => group.count >= USUAL_MEAL_MIN_COUNT)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_USUAL_MEALS)
    .map((group) => group.latest);
}

const number = (value, max) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, max) : null);
function parseItem(item) {
  const name = typeof item?.name === "string" ? item.name.trim() : "";
  const grams = number(item?.grams, MAX_FOOD_GRAMS);
  const per100 = Object.fromEntries(NUTRIENTS.map((n) => [n, number(item?.per100?.[n], MAX_PER_100G[n])]));
  if (!name || !grams || Object.values(per100).includes(null)) return null;
  return { name, grams: Math.round(grams), per100 };
}

// The AI's draft of a meal, checked: items with a name, grams and every value per 100 g in range, and at most one question
// whose options each add a valid item or nothing.
export function parseFoodDraft(answer) {
  const items = (Array.isArray(answer?.items) ? answer.items : []).map(parseItem).filter(Boolean);
  const options = (Array.isArray(answer?.question?.options) ? answer.question.options : [])
    .filter((option) => typeof option?.label === "string" && option.label.trim())
    .slice(0, 4)
    .map((option) => ({ label: option.label.trim(), add: option.add ? parseItem(option.add) : null }));
  const text = typeof answer?.question?.text === "string" ? answer.question.text.trim() : "";
  return {
    name: typeof answer?.name === "string" ? answer.name.trim() : "",
    items,
    question: items.length && text && options.length >= 2 ? { text, options } : null,
  };
}

// For the coach: today's protein against the target and the week's average, only once something was logged this week.
export function foodContext(food, todayKey, target) {
  const week = dailyProtein(food, todayKey, 7);
  const logged = week.filter((day) => mealsOn(food, day.date).length);
  if (!logged.length) return null;
  const todays = dayTotals(food, todayKey);
  const average = Math.round(logged.reduce((total, day) => total + day.protein, 0) / logged.length);
  return [
    `FOOD (estimated from photos and descriptions, usually on the low side; use it only when they ask about food or recovery): today ${Math.round(todays.protein)} g protein`,
    target && ` (target ${target.low}-${target.high} g)`,
    `, about ${Math.round(todays.kcal)} kcal; average ${average} g protein a day over the ${logged.length} logged days this week.`,
  ]
    .filter(Boolean)
    .join("");
}
