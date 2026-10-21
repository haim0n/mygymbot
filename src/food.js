import { FOOD_HISTORY_DAYS, MAX_FOOD_GRAMS, MAX_PER_100G, MAX_USUAL_MEALS, PROTEIN_PER_KG, USUAL_MEAL_MIN_COUNT } from "./config.js";
import { parseDate, toDateKey, weekStart } from "./dates.js";
import { addDays } from "./schedule.js";

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

// The days before today with a meal logged, newest first.
export const pastDays = (food, todayKey) => [...new Set(food.map((meal) => meal.date))].filter((date) => date < todayKey).sort().reverse();

// Protein a day in each of the last `weeks` Monday weeks up to todayKey, oldest first: the average over the days before today
// with a meal, so neither a day left blank nor today's half-logged day pulls the week down. 0 for a week with nothing logged.
export function weeklyProtein(food, todayKey, weeks) {
  return Array.from({ length: weeks }, (_, i) => {
    const week = addDays(weekStart(todayKey), -7 * (weeks - 1 - i));
    const end = addDays(week, 7);
    const days = [...new Set(food.filter((meal) => meal.date >= week && meal.date < end && meal.date < todayKey).map((meal) => meal.date))];
    const protein = days.reduce((total, date) => total + dayTotals(food, date).protein, 0) / (days.length || 1);
    return { week, protein: Math.round(protein) };
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

// For the coach: today's protein against the target and the week's average, then each day that Past days lists, with its meals
// and whether they worked out, and the protein on workout days against other days, worked out here so the coach only reads it.
export function foodContext(food, workouts, todayKey, target) {
  const week = dailyProtein(food, todayKey, 7).filter((day) => mealsOn(food, day.date).length);
  const days = pastDays(food, todayKey).slice(0, FOOD_HISTORY_DAYS);
  if (!week.length && !days.length) return null;
  const todays = dayTotals(food, todayKey);
  const workoutDays = new Set(workouts.map((w) => w.date));
  const trained = days.filter((date) => workoutDays.has(date));
  const other = days.filter((date) => !workoutDays.has(date));
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const protein = (dates) => Math.round(dates.reduce((total, date) => total + dayTotals(food, date).protein, 0) / dates.length);
  const dayLine = (date) => {
    const totals = dayTotals(food, date);
    const meals = mealsOn(food, date).sort((a, b) => a.time.localeCompare(b.time));
    return [
      `- ${date}${workoutDays.has(date) ? ", workout day" : ""}: ${Math.round(totals.protein)} g protein, about ${Math.round(totals.kcal)} kcal, `,
      `${Math.round(totals.carbs)} g carbs, ${Math.round(totals.fat)} g fat; ${meals.map((meal) => `${meal.time} ${meal.name}`).join(", ")}`,
    ].join("");
  };
  const todayLine = week.length
    ? [
        `today ${Math.round(todays.protein)} g protein`,
        target && ` (target ${target.low}-${target.high} g)`,
        `, about ${Math.round(todays.kcal)} kcal; average ${protein(week.map((day) => day.date))} g protein a day over the ${week.length} logged days this week.`,
      ]
        .filter(Boolean)
        .join("")
    : "nothing logged in the last 7 days.";
  return [
    `FOOD (estimated from photos and descriptions, usually on the low side; use it only when they ask about food or recovery, or what may explain how a workout went): ${todayLine}`,
    trained.length > 0 && other.length > 0 && `Protein a day on the logged days before today: ${protein(trained)} g over ${plural(trained.length, "workout day")}, ${protein(other)} g over ${plural(other.length, "other day")}.`,
    days.length > 0 && `Each logged day before today, newest first (protein, kcal, carbs, fat; meals):\n${days.map(dayLine).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");
}
