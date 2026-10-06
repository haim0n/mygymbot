import { BODYWEIGHT_CONTEXT_ENTRIES, COACH_STYLES, DEFAULT_SETTINGS, MUSCLE_LABELS, PAIN_LOOKBACK_DAYS, PLAN_STATUS, WEEKDAYS } from "./config.js";
import { daysBetween, formatClock, today } from "./dates.js";
import { currentBodyweight, personalRecords, sortNewestFirst } from "./training.js";
import { formatRange } from "./autopilot.js";
import { formatSets, weeklyMuscleSets } from "./muscles.js";
import { nextRoutine } from "./workout.js";
import { forecastText, goalForecast, todayPlan } from "./schedule.js";
import { activityLabel, activitySummary, summaryText } from "./activities.js";

export function formatWorkoutLine(w) {
  const checkIn = w.checkIn && !w.checkIn.skipped ? ` (felt: ${w.checkIn.effort}; pain: ${w.checkIn.pain}${w.checkIn.note ? `; ${w.checkIn.note}` : ""})` : "";
  const lifts = w.exercises.map((e) => `${e.name} ${e.sets.map((s) => `${s.weight}x${s.reps}`).join(", ")}`);
  const activities = (w.activities ?? []).map((a) => `${activityLabel(a)}${a.effort ? ` (${a.effort.toLowerCase()})` : ""}`);
  return `${w.date}: ${[...lifts, ...activities].join("; ")}` + (w.notes ? ` (notes: ${w.notes})` : "") + checkIn;
}

// Check-ins from the last two weeks that reported pain, newest first, so the coach can't miss them among the workouts.
export function recentPainLines(workouts) {
  return sortNewestFirst(workouts)
    .filter((w) => w.checkIn?.pain && w.checkIn.pain !== "No" && !w.checkIn.skipped && daysBetween(w.date, today()) <= PAIN_LOOKBACK_DAYS)
    .map((w) => `- ${w.date}: pain "${w.checkIn.pain}" after ${w.exercises.map((e) => e.name).join(", ") || "this session"}${w.checkIn.note ? `; note: ${w.checkIn.note}` : ""}`);
}

export function buildCoachContext({ profile, goals, routines = [] }, workouts, plans, learnedMuscles, session, bodyweightLog = []) {
  const u = profile.unit;
  const formatWorkout = formatWorkoutLine;
  const schedule = (profile.trainingDays ?? []).length
    ? `trains ${WEEKDAYS.filter((d) => profile.trainingDays.includes(d.day)).map((d) => d.label).join(", ")}${profile.trainingTime ? ` at ${profile.trainingTime}` : ""}`
    : `aims for ${profile.daysPerWeek} sessions/week`;
  const plan = todayPlan(profile, workouts);
  const todayLine = {
    planned: `a workout is planned today${plan.time ? ` at ${plan.time}` : ""} and not done yet`,
    late: `a workout was planned today at ${plan.time} and hasn't happened yet`,
    done: "they already trained today",
    rest: "rest day",
    unscheduled: "no schedule set",
  }[plan.status];
  const forecasts = goals.map((g) => `- ${g.exercise} ${g.target}${u}: ${forecastText(goalForecast(workouts, g, personalRecords(workouts)[g.exercise]?.e1rm ?? 0), u) || "reached"}`);
  const records = Object.entries(personalRecords(workouts)).map(
    ([name, r]) => `- ${name}: ${r.e1rm}${u} est. 1RM (${r.set.weight}x${r.set.reps} on ${r.date})`
  );
  const goalLines = goals.map((g) => `- ${g.exercise} ${g.target}${u} 1RM${g.deadline ? ` by ${g.deadline}` : ""}`);
  const recent = sortNewestFirst(workouts).slice(0, 40).map(formatWorkout);
  const pain = recentPainLines(workouts);
  const name = profile.name?.trim() ? `name ${profile.name.trim()}, ` : "";
  const targets = plans.map(
    (p) => `- ${p.name}: ${p.target.sets}x${p.target.reps} @ ${p.target.weight}${u} (${PLAN_STATUS[p.status].label.toLowerCase()}, rep range ${formatRange(p.range)}, rest ${formatClock(p.rest)})`
  );
  const next = nextRoutine(routines, workouts);
  const lastDone = (routine) => sortNewestFirst(workouts).find((w) => w.routine === routine.name)?.date;
  const routineLines = routines.map((r) => `- ${r.name}: ${r.exercises.join(", ")}${lastDone(r) ? ` (last done ${lastDone(r)})` : ""}`);

  return [
    `Today is ${today()}. Weights are in ${u}, written weight x reps; dumbbell weights are per dumbbell.`,
    `ATHLETE: ${name}${profile.experience}, bodyweight ${currentBodyweight(bodyweightLog, profile) ?? "unknown"}${u}, ${schedule}, focus: ${profile.focus}, coaching style: ${COACH_STYLES[profile.coachStyle ?? DEFAULT_SETTINGS.profile.coachStyle]}.`,
    profile.notes && `INJURIES AND EQUIPMENT (from the athlete's profile; plan around these): ${profile.notes}`,
    profile.foodNotes && `FOOD PREFERENCES: ${profile.foodNotes}`,
    pain.length > 0 && `RECENT PAIN (from post-workout check-ins; adapt plans around it):\n${pain.join("\n")}`,
    `TODAY: ${todayLine}.`,
    bodyweightLog.length > 1 &&
      `BODYWEIGHT LOG (${u}, oldest first): ${bodyweightLog.slice(-BODYWEIGHT_CONTEXT_ENTRIES).map((e) => `${e.date} ${e.weight}`).join(", ")}`,
    `GOALS:\n${goalLines.join("\n") || "none set"}`,
    goals.length > 0 && `GOAL FORECASTS (straight line from the last 12 weeks; gains usually slow over time):\n${forecasts.join("\n")}`,
    `BEST LIFTS:\n${records.join("\n") || "none yet"}`,
    `AUTOPILOT TARGETS FOR NEXT TIME (double progression):\n${targets.join("\n") || "none yet"}`,
    `WORKOUT PLANS (done in turn${next ? `, next: ${next.name}` : ""}):\n${routineLines.join("\n") || "none saved"}`,
    session &&
      `WORKOUT IN PROGRESS (in order, weight x reps): ${
        session.exercises
          .map((e) => `${e.name} ${e.sets.map((set) => `${set.weight}x${set.reps}${set.done ? " done" : " to do"}`).join(", ")}`)
          .join("; ") || "just started"
      }`,
    `SETS PER MUSCLE, LAST 7 DAYS (main muscle 1, helper 0.5): ${Object.entries(weeklyMuscleSets(workouts, learnedMuscles))
      .map(([m, sets]) => `${MUSCLE_LABELS[m]} ${formatSets(sets)}`)
      .join(", ")}`,
    `ACTIVITIES, LAST 7 DAYS: ${activitySummary(workouts).map((s) => `${s.type}: ${summaryText(s)}`).join("; ") || "none"}`,
    `RECENT WORKOUTS (newest first):\n${recent.join("\n") || "none logged yet"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
