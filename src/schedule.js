import { CHECK_IN_WINDOW_DAYS, FORECAST_LOOKBACK_DAYS, FORECAST_MAX_DAYS, FORECAST_MIN_SESSIONS, FORECAST_MIN_SPAN_DAYS, FORECAST_MIN_WEEKLY_GAIN, LATE_AFTER_HOURS } from "./config.js";
import { daysBetween, formatLongDate, parseDate, toDateKey, today } from "./dates.js";
import { estimate1RM, round1, sortNewestFirst, sortOldestFirst } from "./training.js";

// Today against the training schedule: "planned", "late" (2+ hours past the planned time), "done", "rest" or "unscheduled".
export function todayPlan(profile, workouts, now = new Date()) {
  const days = profile.trainingDays ?? [];
  const time = profile.trainingTime || "";
  if (workouts.some((w) => w.date === today())) return { status: "done" };
  if (!days.length) return { status: "unscheduled" };
  if (!days.includes(now.getDay())) return { status: "rest" };
  if (time) {
    const [hours, minutes] = time.split(":").map(Number);
    const planned = new Date(now);
    planned.setHours(hours, minutes, 0, 0);
    if (now - planned > LATE_AFTER_HOURS * 3_600_000) return { status: "late", time };
  }
  return { status: "planned", time };
}

// The latest workout, if it's recent and you haven't told the coach how it went.
export function pendingCheckIn(workouts) {
  const latest = sortNewestFirst(workouts)[0];
  return latest && !latest.checkIn && daysBetween(latest.date, today()) <= CHECK_IN_WINDOW_DAYS ? latest : null;
}

// Straight-line trend of an exercise's best estimated 1RM per session over the last 12 weeks
// (least squares, x = days from today). Null when there's too little data to say anything honest.
export function strengthTrend(workouts, exercise) {
  const points = sortOldestFirst(workouts)
    .filter((w) => daysBetween(w.date, today()) <= FORECAST_LOOKBACK_DAYS)
    .flatMap((w) => {
      const sets = w.exercises.filter((e) => e.name === exercise).flatMap((e) => e.sets);
      return sets.length ? [{ x: daysBetween(today(), w.date), y: Math.max(...sets.map(estimate1RM)) }] : [];
    });
  if (points.length < FORECAST_MIN_SESSIONS || points.at(-1).x - points[0].x < FORECAST_MIN_SPAN_DAYS) return null;
  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const meanX = mean(points.map((p) => p.x));
  const meanY = mean(points.map((p) => p.y));
  const perDay = points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0) / points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);
  return { perDay, todayValue: meanY - perDay * meanX };
}

export function addDays(dateKey, days) {
  const d = parseDate(dateKey);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

// When a goal is reached if the recent rate of progress continues.
export function goalForecast(workouts, goal, current) {
  if (current >= goal.target) return { status: "reached" };
  const trend = strengthTrend(workouts, goal.exercise);
  if (!trend) return { status: "not-enough-data" };
  const weeklyGain = trend.perDay * 7;
  if (weeklyGain < FORECAST_MIN_WEEKLY_GAIN) return { status: "flat" };
  const days = Math.max(7, Math.ceil((goal.target - trend.todayValue) / trend.perDay));
  if (days > FORECAST_MAX_DAYS) return { status: "far", weeklyGain };
  const date = addDays(today(), days);
  const daysLeft = goal.deadline ? daysBetween(today(), goal.deadline) : null;
  return {
    status: "forecast",
    date,
    weeklyGain,
    daysVsDeadline: goal.deadline ? daysBetween(goal.deadline, date) : null, // > 0 means after the deadline
    neededWeeklyGain: daysLeft > 0 ? ((goal.target - trend.todayValue) / daysLeft) * 7 : null,
  };
}

export const spanText = (days) => (Math.abs(days) < 14 ? `${Math.abs(days)} days` : `${Math.round(Math.abs(days) / 7)} weeks`);

export function forecastText(forecast, unit) {
  switch (forecast.status) {
    case "forecast": {
      const { date, weeklyGain, daysVsDeadline, neededWeeklyGain } = forecast;
      const deadline =
        daysVsDeadline === null ? "" : daysVsDeadline <= 0 ? `, ${spanText(daysVsDeadline)} before your deadline` : `, ${spanText(daysVsDeadline)} after your deadline`;
      const needed = daysVsDeadline > 0 && neededWeeklyGain ? ` To make the deadline you'd need about ${round1(neededWeeklyGain)} ${unit} a week.` : "";
      return `Forecast: around ${formatLongDate(date)}${deadline}. You're gaining about ${round1(weeklyGain)} ${unit} a week.${needed}`;
    }
    case "far":
      return `Forecast: more than a year away at about ${round1(forecast.weeklyGain)} ${unit} a week.`;
    case "flat":
      return "Forecast: progress on this lift has been flat lately, so no date yet.";
    case "not-enough-data":
      return "Forecast: log this lift a few more times over 2+ weeks to get one.";
    default:
      return "";
  }
}
