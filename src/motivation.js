import { GOAL_CLOSE_RATIO, GOAL_DUE_SOON_DAYS, MILESTONES, RECENT_RECORD_DAYS } from "./config.js";
import { daysBetween, formatShortDate, joinWords, parseDate, toDateKey, today, weekStart } from "./dates.js";
import { personalRecords, round1, sortNewestFirst } from "./training.js";
import { buildAutopilotPlans } from "./autopilot.js";
import { nextRoutine } from "./workout.js";
import { pendingCheckIn, todayPlan } from "./schedule.js";
import { activityLabel, activityType, paceText } from "./activities.js";

export const SEE_TARGETS = { label: "See targets", tab: "log" };

export const weeklyTarget = (profile) => Math.max(1, Math.round(Number(profile.daysPerWeek)) || 1);
// Training days in the week containing `dateKey` (a gym session and a swim on the same day count once).
export const sessionsInWeekOf = (workouts, dateKey) => new Set(workouts.filter((w) => weekStart(w.date) === weekStart(dateKey)).map((w) => w.date)).size;

export const listNames = (names) => (names.length > 3 ? `${names.length} lifts` : joinWords(names));

// Consecutive weeks that met the weekly target, counting back from last week. This week counts once it's met.
export function weeklyStreak(workouts, target) {
  const thisMonday = parseDate(weekStart(today()));
  const sessionsWeeksAgo = (weeksAgo) => {
    const monday = new Date(thisMonday);
    monday.setDate(monday.getDate() - 7 * weeksAgo);
    return sessionsInWeekOf(workouts, toDateKey(monday));
  };
  let streak = sessionsWeeksAgo(0) >= target ? 1 : 0;
  for (let weeksAgo = 1; sessionsWeeksAgo(weeksAgo) >= target; weeksAgo++) streak++;
  return streak;
}

// Best-ever lifts from the last week that beat an earlier best (a first attempt isn't a record).
export function recentRecords(workouts) {
  return Object.entries(personalRecords(workouts))
    .filter(([, record]) => record.e1rm > 0 && daysBetween(record.date, today()) <= RECENT_RECORD_DAYS)
    .map(([name, record]) => ({ name, e1rm: record.e1rm, previous: personalRecords(workouts.filter((w) => w.date < record.date))[name]?.e1rm }))
    .filter((record) => record.previous !== undefined && record.e1rm > record.previous);
}

export function goalFacts(goals, records, unit) {
  return goals.flatMap((goal) => {
    const current = records[goal.exercise]?.e1rm ?? 0;
    const toGo = round1(goal.target - current);
    const daysLeft = goal.deadline ? daysBetween(today(), goal.deadline) : null;
    if (toGo <= 0) return [];
    if (current >= goal.target * GOAL_CLOSE_RATIO) return [{ tone: "celebrate", text: `Only ${toGo} ${unit} to go on your ${goal.exercise} goal.` }];
    if (daysLeft !== null && daysLeft >= 0 && daysLeft <= GOAL_DUE_SOON_DAYS)
      return [{ tone: "nudge", text: `Your ${goal.exercise} goal is due in ${daysLeft} days, ${toGo} ${unit} to go.` }];
    return [];
  });
}

export function weekProgressFact(count, target) {
  if (count > target) return { tone: "celebrate", text: `${count} sessions this week, beating your target of ${target}.` };
  if (count === target) return { tone: "celebrate", text: `Weekly target hit: ${count} of ${target} sessions.` };
  return { tone: "info", text: `${count} of ${target} sessions this week.` };
}

// What the Today card shows when the app opens, most actionable first.
// Each fact: { tone: "celebrate" | "nudge" | "info", text, action?: { label, tab } }
export function todayFacts({ workouts, settings, records, plans }) {
  const { profile, goals } = settings;
  if (!workouts.length) {
    return [{ tone: "nudge", text: "Log your first workout and Autopilot will set your targets.", action: { label: "Log one", tab: "log" } }];
  }
  const target = weeklyTarget(profile);
  const daysAway = daysBetween(sortNewestFirst(workouts)[0].date, today());
  const streak = weeklyStreak(workouts, target);
  const increases = plans.filter((p) => p.status === "increase").map((p) => p.name);
  const plan = todayPlan(profile, workouts);
  const next = nextRoutine(settings.routines ?? [], workouts);
  const checkIn = pendingCheckIn(workouts);
  const START = { label: "Start", tab: "log" };

  return [
    plan.status === "planned" && {
      tone: "plan",
      text: `Workout planned today${plan.time ? ` at ${plan.time}` : ""}. ${next ? `Next up: ${next.name}.` : `${plans.length} exercises are ready in Up next.`}`,
      action: START,
    },
    plan.status === "late" && { tone: "nudge", text: `Today's ${plan.time} session hasn't happened yet. A shorter one still counts.`, action: START },
    plan.status === "rest" && { tone: "info", text: "Rest day. Recovery is when the strength gets built." },
    checkIn && { tone: "nudge", text: `How did your ${formatShortDate(checkIn.date)} workout feel? Your coach would like to know.`, action: { label: "Check in", tab: "log" } },
    plan.status === "unscheduled" && daysAway > Math.ceil(7 / target) && {
      tone: "nudge",
      text: `${daysAway} days since your last session. Your targets are ready when you are.`,
      action: SEE_TARGETS,
    },
    ...recentRecords(workouts).map((r) => ({
      tone: "celebrate",
      text: `New best this week on ${r.name}: est. 1RM ${r.e1rm} ${profile.unit}, up ${round1(r.e1rm - r.previous)} ${profile.unit}.`,
    })),
    increases.length > 0 && { tone: "celebrate", text: `You've earned a weight increase on ${listNames(increases)}.`, action: SEE_TARGETS },
    ...goalFacts(goals, records, profile.unit),
    streak >= 2 && { tone: "celebrate", text: `${streak} weeks in a row on target.` },
    weekProgressFact(sessionsInWeekOf(workouts, today()), target),
  ].filter(Boolean);
}

// What to celebrate right after a session is saved.
export function sessionHighlights(workout, earlierWorkouts, settings) {
  const { unit } = settings.profile;
  const all = [...earlierWorkouts, workout];
  const before = personalRecords(earlierWorkouts);
  const after = personalRecords(all);
  const names = [...new Set(workout.exercises.map((e) => e.name))];
  const increases = buildAutopilotPlans(all, settings).filter((p) => p.status === "increase" && names.includes(p.name));
  const isThisWeek = weekStart(workout.date) === weekStart(today());
  const earlierActivities = earlierWorkouts.flatMap((w) => w.activities ?? []);
  const activityFacts = (workout.activities ?? []).flatMap((a) => {
    const pace = paceText(a);
    const longest = Math.max(0, ...earlierActivities.filter((p) => p.type === a.type && p.distanceUnit === a.distanceUnit).map((p) => p.distance || 0));
    return [
      { tone: "celebrate", text: `${activityLabel(a)}${pace ? ` (${pace})` : ""} logged.` },
      a.distance && longest > 0 && a.distance > longest && { tone: "celebrate", text: `Your longest ${activityType(a.type).noun ?? a.type.toLowerCase()} yet, beating ${longest} ${a.distanceUnit}.` },
    ];
  });

  return [
    ...activityFacts,
    ...names
      .filter((name) => before[name] && after[name].e1rm > before[name].e1rm)
      .map((name) => ({
        tone: "celebrate",
        text: `New best on ${name}: est. 1RM ${after[name].e1rm} ${unit}, up ${round1(after[name].e1rm - before[name].e1rm)} ${unit}.`,
      })),
    ...increases.map((p) => ({ tone: "celebrate", text: `${p.name} goes up to ${p.target.weight} ${unit} next time.` })),
    MILESTONES.includes(all.length) && { tone: "celebrate", text: `That's ${all.length} sessions logged.` },
    isThisWeek && weekProgressFact(sessionsInWeekOf(all, workout.date), weeklyTarget(settings.profile)),
  ].filter(Boolean);
}
