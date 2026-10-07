// Unit tests for GymBot's pure logic, imported straight from its modules (no browser). Run: npm test
// Dates are built relative to the real today, because the app's logic reads today's date.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as config from "../src/config.js";
import * as dates from "../src/dates.js";
import * as training from "../src/training.js";
import * as autopilot from "../src/autopilot.js";
import * as motivation from "../src/motivation.js";
import * as muscles from "../src/muscles.js";
import * as liveWorkout from "../src/workout.js";
import * as schedule from "../src/schedule.js";
import * as activities from "../src/activities.js";
import * as importing from "../src/import.js";
import * as coach_context from "../src/coach-context.js";

const app = { ...config, ...dates, ...training, ...autopilot, ...motivation, ...muscles, ...liveWorkout, ...schedule, ...activities, ...importing, ...coach_context };

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return app.toDateKey(d);
};
const ex = (name, pairs) => ({ name, sets: pairs.map(([weight, reps]) => ({ weight, reps })) });
const workout = (id, date, exercises, extra = {}) => ({ id, date, notes: "", exercises, ...extra });
const settingsWith = (repRanges = {}) => ({ profile: { unit: "kg", focus: "Strength", daysPerWeek: 3 }, goals: [], repRanges });
const planFor = (plans, name) => {
  const { status, target } = plans.find((p) => p.name === name);
  return { status, ...target };
};

// The user's real Sep 23 workout (imported from a screenshot), dated relative to today.
const userWorkout = (date) =>
  workout("user", date, [
    ex("Bench Press (Dumbbell)", [[44, 10], [44, 9], [32, 3]]),
    ex("Front Squat (Kettlebell)", [[10, 16], [10, 16], [10, 16]]),
    ex("Lat Pulldown (Cable)", [[45, 10], [45, 9], [45, 6], [39, 4]]),
    ex("Seated Row (Close Grip) (Machine)", [[35, 11], [35, 11], [35, 10]]),
    ex("Seated Chest Fly (Machine)", [[32, 11], [32, 10], [32, 7], [27, 4]]),
    ex("Incline Bicep Curl (Dumbbell)", [[14, 10], [10, 5], [14, 8], [10, 4], [14, 5], [10, 4]]),
    ex("Hammer Curl (Dumbbell)", [[7, 11], [5, 8], [7, 7], [5, 6], [7, 9], [5, 6]]),
  ]);

test("Autopilot: add weight, add reps, repeat, deload (missed twice), deload (long break)", () => {
  const plans = app.buildAutopilotPlans(
    [
      workout("1", daysAgo(10), [ex("Bench Press", [[80, 8], [80, 8], [80, 8]])]),
      workout("2", daysAgo(9), [ex("Back Squat", [[100, 10], [100, 9], [100, 9]])]),
      workout("3", daysAgo(12), [ex("Overhead Press", [[50, 7], [50, 6], [50, 6]])]),
      workout("4", daysAgo(5), [ex("Overhead Press", [[50, 7], [50, 7], [50, 6]])]),
      workout("5", daysAgo(4), [ex("Barbell Row", [[70, 9], [70, 7], [70, 6]])]),
      workout("6", daysAgo(40), [ex("Deadlift", [[140, 12], [140, 12], [140, 12]])]),
    ],
    settingsWith({ "Bench Press": [5, 8], "Back Squat": [8, 12], "Overhead Press": [8, 12], "Barbell Row": [8, 12], Deadlift: [8, 12] })
  );
  assert.deepEqual(planFor(plans, "Bench Press"), { status: "increase", sets: 3, reps: 5, weight: 82.5 });
  assert.deepEqual(planFor(plans, "Back Squat"), { status: "reps", sets: 3, reps: 10, weight: 100 });
  assert.deepEqual(planFor(plans, "Overhead Press"), { status: "deload", sets: 3, reps: 8, weight: 45 });
  assert.deepEqual(planFor(plans, "Barbell Row"), { status: "repeat", sets: 3, reps: 8, weight: 70 });
  assert.deepEqual(planFor(plans, "Deadlift"), { status: "deload", sets: 3, reps: 8, weight: 125 });
});

test("Autopilot: pain reported after the last session holds the weight instead of adding to it", () => {
  const benchAt = (checkIn) => [workout("1", daysAgo(3), [ex("Bench Press", [[80, 8], [80, 8], [80, 8]])], checkIn ? { checkIn } : {})];
  const statusWith = (checkIn) => planFor(app.buildAutopilotPlans(benchAt(checkIn), settingsWith({ "Bench Press": [5, 8] })), "Bench Press");
  assert.deepEqual(statusWith({ effort: "Hard", pain: "A little", note: "" }), { status: "hold", sets: 3, reps: 8, weight: 80 });
  assert.deepEqual(statusWith({ effort: "Hard", pain: "Yes", note: "elbow" }), { status: "hold", sets: 3, reps: 8, weight: 80 });
  assert.equal(statusWith({ effort: "Hard", pain: "No", note: "" }).status, "increase");
  assert.equal(statusWith({ skipped: true }).status, "increase");
  assert.equal(statusWith(null).status, "increase");
});

test("Autopilot: lifts that work a muscle hurt per the profile's injury note hold the weight", () => {
  const log = [workout("1", daysAgo(3), [ex("Bench Press", [[80, 8], [80, 8]]), ex("Back Squat", [[100, 8], [100, 8]])])];
  const ranges = { "Bench Press": [5, 8], "Back Squat": [5, 8] };
  const withNote = (notes, injuryAreas) => ({ ...settingsWith(ranges), profile: { unit: "kg", notes }, injuryAreas });
  const shoulder = app.buildAutopilotPlans(log, withNote("Left shoulder sore", { notes: "Left shoulder sore", muscles: ["shoulders"] }));
  assert.equal(planFor(shoulder, "Bench Press").status, "hold"); // shoulders help on bench
  assert.equal(planFor(shoulder, "Back Squat").status, "increase");
  assert.match(shoulder.find((p) => p.name === "Bench Press").reason, /Easy on your shoulders/);
  // A note changed since it was read (here: the injury is gone) holds nothing until it's read again.
  const stale = app.buildAutopilotPlans(log, withNote("", { notes: "Left shoulder sore", muscles: ["shoulders"] }));
  assert.equal(planFor(stale, "Bench Press").status, "increase");
});

test("Coach context: pain from recent check-ins is listed up front, older or pain-free ones aren't", () => {
  const settings = { profile: { unit: "kg", experience: "Intermediate", daysPerWeek: 3, focus: "Strength", coachStyle: "Encouraging" }, goals: [] };
  const workouts = [
    workout("1", daysAgo(2), [ex("Back Squat", [[100, 5]])], { checkIn: { effort: "Hard", pain: "Yes", note: "left knee" } }),
    workout("2", daysAgo(5), [ex("Bench Press", [[80, 8]])], { checkIn: { effort: "Easy", pain: "No", note: "" } }),
    workout("3", daysAgo(30), [ex("Deadlift", [[140, 5]])], { checkIn: { effort: "Hard", pain: "A little", note: "lower back" } }),
  ];
  const context = app.buildCoachContext(settings, workouts, [], {}, null);
  const painBlock = context.split("\n\n").find((block) => block.startsWith("RECENT PAIN"));
  assert.equal(painBlock.split("\n").length, 2);
  assert.match(painBlock, new RegExp(`${daysAgo(2)}: pain "Yes" after Back Squat; note: left knee`));
  assert.ok(!app.buildCoachContext(settings, workouts.slice(1), [], {}, null).includes("RECENT PAIN"));
});

test("Coach context: the athlete's name comes from the profile, when given", () => {
  const settings = (name) => ({ profile: { name, unit: "kg", experience: "Intermediate", daysPerWeek: 3, focus: "Strength" }, goals: [] });
  const athleteLine = (name) => app.buildCoachContext(settings(name), [], [], {}, null).split("\n\n").find((block) => block.startsWith("ATHLETE:"));
  assert.match(athleteLine(" Haim "), /^ATHLETE: name Haim, Intermediate/);
  assert.match(athleteLine(""), /^ATHLETE: Intermediate/);
  assert.match(athleteLine(undefined), /^ATHLETE: Intermediate/); // profiles saved before the field existed
});

test("Bodyweight: one entry per day, kept in date order; the coach sees the current weight and the log", () => {
  let log = app.logBodyweight([], "2026-10-03", 81);
  log = app.logBodyweight(log, "2026-09-20", 82.5);
  log = app.logBodyweight(log, "2026-10-03", 80.5); // same day: replaces
  assert.deepEqual(log, [{ date: "2026-09-20", weight: 82.5 }, { date: "2026-10-03", weight: 80.5 }]);
  assert.equal(app.currentBodyweight(log, { bodyweight: "90" }), 80.5);
  assert.equal(app.currentBodyweight([], { bodyweight: "90" }), 90); // profiles from before the log
  assert.equal(app.currentBodyweight([], { bodyweight: "" }), null);

  const settings = { profile: { unit: "kg", experience: "Intermediate", daysPerWeek: 3, focus: "Strength", bodyweight: "90" }, goals: [] };
  const context = app.buildCoachContext(settings, [], [], {}, null, log);
  assert.match(context, /ATHLETE: Intermediate, bodyweight 80.5kg/);
  assert.match(context, /BODYWEIGHT LOG \(kg, oldest first\): 2026-09-20 82.5, 2026-10-03 80.5/);
  assert.match(app.buildCoachContext(settings, [], [], {}, null), /bodyweight 90kg/);
});

test("Autopilot: lighter warm-up/back-off sets are ignored; weights land on real equipment steps", () => {
  const top = (name, weight) => workout(name, daysAgo(3), [ex(name, [[weight, 12], [weight, 12]])]);
  const names = ["Bench Press (Dumbbell)", "Goblet Squat (Kettlebell)", "Lat Pulldown (Cable)", "Bench Press", "Back Squat", "Leg Press (Machine)"];
  const plans = app.buildAutopilotPlans(
    [top(names[0], 44), top(names[1], 12), top(names[2], 39), top(names[3], 80), top(names[4], 100), top(names[5], 140),
     workout("rdl", daysAgo(3), [ex("Romanian Deadlift", [[40, 10], [90, 12], [90, 12]])])],
    settingsWith(Object.fromEntries([...names, "Romanian Deadlift"].map((n) => [n, [8, 12]])))
  );
  assert.deepEqual(names.map((n) => planFor(plans, n).weight), [46, 16, 40, 82.5, 105, 145]);
  assert.deepEqual(planFor(plans, "Romanian Deadlift"), { status: "increase", sets: 2, reps: 8, weight: 95 });
});

test("Autopilot: the inferred rep range stays put while you follow the targets", () => {
  let log = [{ ...userWorkout(daysAgo(16)) }];
  const ranges = new Set();
  for (let session = 1; session <= 15; session++) {
    const plan = app.buildAutopilotPlans(log, settingsWith()).find((p) => p.name === "Bench Press (Dumbbell)");
    ranges.add(app.formatRange(plan.range));
    const { sets, reps, weight } = plan.target;
    log = [...log, workout(`s${session}`, daysAgo(16 - session), [ex("Bench Press (Dumbbell)", Array.from({ length: sets }, () => [weight, reps]))])];
  }
  assert.deepEqual([...ranges], ["8–12"]);
  assert.equal(log.at(-1).exercises[0].sets[0].weight, 50); // 44 → 46 → 48 → 50
});

test("Autopilot: recommended rest follows the rep range, with extra for big lifts", () => {
  assert.equal(app.restSeconds("Bench Press (Dumbbell)", [8, 12]), 90);
  assert.equal(app.restSeconds("Back Squat", [3, 6]), 240);
  assert.equal(app.restSeconds("Lateral Raise", [12, 20]), 60);
});

test("Import: Strong and Hevy exports (units, warm-ups, cardio rows, dates, duplicates)", () => {
  const rows = (headers, lines) => lines.map((cells) => Object.fromEntries(headers.map((h, i) => [h, cells[i]])));
  const strong = ["Date", "Workout Name", "Exercise Name", "Set Order", "Weight", "Weight Unit", "Reps", "Distance", "Seconds"];
  const strongResult = app.rowsToWorkouts(
    rows(strong, [
      ["2024-03-04 18:01:22", "Push", "Bench Press (Barbell)", "1", "225", "lbs", "5", "", ""],
      ["2024-03-04 18:01:22", "Push", "Bench Press (Barbell)", "2", "225", "lbs", "5", "", ""],
      ["2024-03-04 18:01:22", "Push", "Running", "1", "0", "lbs", "", "3", "1200"],
    ]),
    app.detectColumns(strong),
    "kg"
  );
  assert.deepEqual(strongResult.workouts[0].exercises, [{ name: "Bench Press", sets: [{ reps: 5, weight: 102 }, { reps: 5, weight: 102 }] }]);
  assert.equal(strongResult.skipped, 1);

  const hevy = ["title", "start_time", "exercise_title", "set_index", "set_type", "weight_kg", "reps"];
  const hevyResult = app.rowsToWorkouts(
    rows(hevy, [
      ["Legs", "21 Aug 2024, 18:05", "Squat (Barbell)", "0", "warmup", "60", "5"],
      ["Legs", "21 Aug 2024, 18:05", "Squat (Barbell)", "1", "normal", "140", "5"],
    ]),
    app.detectColumns(hevy),
    "kg"
  );
  assert.equal(hevyResult.workouts[0].date, "2024-08-21");
  assert.deepEqual(hevyResult.workouts[0].exercises, [{ name: "Squat", sets: [{ reps: 5, weight: 140 }] }]);
  assert.equal(app.withoutDuplicates(hevyResult.workouts, hevyResult.workouts).length, 0);

  assert.equal(app.hasRequiredColumns(app.detectColumns(["When", "Lift", "Kilos", "Count"])), false); // → the coach maps the columns
  assert.equal(app.dateKeyFromText("3 Sept 2024"), "2024-09-03");
  assert.equal(app.dateKeyFromText("garbage"), null);
});

test("Muscles: built-in rules cover the user's exercises; unknown names go to the coach", () => {
  const describe = (name) => app.describeMuscles(app.ruleMuscles(name));
  assert.equal(describe("Bench Press (Dumbbell)"), "Chest, with triceps and shoulders");
  assert.equal(describe("Front Squat (Kettlebell)"), "Quads and glutes, with hamstrings and core");
  assert.equal(describe("Lat Pulldown (Cable)"), "Lats, with biceps and upper back");
  assert.equal(describe("Seated Row (Close Grip) (Machine)"), "Upper back and lats, with biceps and shoulders");
  assert.equal(describe("Seated Chest Fly (Machine)"), "Chest, with shoulders");
  assert.equal(describe("Incline Bicep Curl (Dumbbell)"), "Biceps, with forearms");
  assert.equal(describe("Hammer Curl (Dumbbell)"), "Forearms and biceps");
  assert.equal(describe("Reverse Fly (Dumbbell)"), "Shoulders and upper back, with traps"); // not chest
  assert.equal(describe("Hanging Leg Raise"), "Core"); // not lateral raise
  assert.equal(app.ruleMuscles("Hip Abduction (Machine)"), null);
});

test("Video library: fixed links only; exercises it doesn't cover get none", () => {
  assert.equal(app.guideFor("Bench Press (Dumbbell)").videos[0].id, "WLTU1j7Ur8M");
  assert.equal(app.guideFor("Squat (Barbell)").exercise, "Barbell back squat");
  assert.equal(app.guideFor("Lat Pulldown (Cable)").videos.length, 2);
  assert.equal(app.guideFor("Front Squat (Kettlebell)"), null);
  assert.equal(app.guideFor("Reverse Fly"), null);
  assert.equal(app.guideFor("Upright Row"), null);
});

test("Live workout: repeat keeps order, reorder respects the ends, only done sets are saved", () => {
  const plans = app.buildAutopilotPlans([userWorkout(daysAgo(3))], settingsWith());
  let s = app.repeatLastWorkout([userWorkout(daysAgo(3))], plans);
  const names = () => s.exercises.map((e) => e.name.split(" (")[0]);
  assert.deepEqual(names().slice(0, 3), ["Bench Press", "Front Squat", "Lat Pulldown"]);
  assert.deepEqual(s.exercises[0].sets.map((x) => [x.weight, x.reps]), [[44, 10], [44, 10]]);

  const [bench, , pulldown] = s.exercises;
  s = app.moveExercise(s, pulldown.id, -1);
  assert.deepEqual(names().slice(0, 3), ["Bench Press", "Lat Pulldown", "Front Squat"]);
  assert.deepEqual(app.moveExercise(s, bench.id, -1).exercises.map((e) => e.id), s.exercises.map((e) => e.id));

  s = app.toggleSet(s, bench.id, bench.sets[0].id);
  s = app.editSet(s, bench.id, bench.sets[1].id, "weight", "46"); // typed values are strings
  s = app.toggleSet(s, bench.id, bench.sets[1].id);
  s = app.addSet(s, bench.id);
  assert.equal(app.currentExerciseId(s), bench.id);
  assert.deepEqual(app.sessionSetCounts(s).done, 2);

  s = app.completeExercise(s, pulldown.id);
  const saved = app.sessionToWorkout(s);
  assert.deepEqual(saved.exercises.map((e) => e.name.split(" (")[0]), ["Bench Press", "Lat Pulldown"]);
  assert.deepEqual(saved.exercises[0].sets, [{ weight: 44, reps: 10 }, { weight: 46, reps: 10 }]);

  const edited = app.sessionToWorkout(app.workoutToSession(saved), { allSets: true });
  assert.deepEqual(edited.exercises, saved.exercises);
});

test("Workout plans: done in turn, started at Autopilot's targets, edited by name, suggested by the coach", () => {
  const a = { name: "A", exercises: ["Bench Press (Dumbbell)", "Zercher Squat"] };
  const b = { name: "B", exercises: ["Lat Pulldown (Cable)"] };
  const tagged = (id, n, routine) => workout(id, daysAgo(n), [ex("Lat Pulldown (Cable)", [[45, 10]])], routine && { routine });
  assert.equal(app.nextRoutine([a, b], []), a);
  assert.equal(app.nextRoutine([a, b], [tagged("1", 3, "A"), tagged("2", 1)]), b); // untagged workouts don't count
  assert.equal(app.nextRoutine([a, b], [tagged("1", 3, "A"), tagged("2", 1, "B")]), a);
  assert.equal(app.nextRoutine([a, b], [tagged("1", 1, "Deleted")]), a);
  assert.equal(app.nextRoutine([], [tagged("1", 1, "A")]), null);

  const plans = app.buildAutopilotPlans([userWorkout(daysAgo(3))], settingsWith());
  const session = app.routineSession(a, plans);
  assert.equal(session.routine, "A");
  assert.deepEqual(session.exercises.map((e) => [e.name, e.sets.map((x) => [x.weight, x.reps])]), [
    ["Bench Press (Dumbbell)", [[44, 10], [44, 10]]],
    ["Zercher Squat", [["", 8], ["", 8], ["", 8]]], // no target yet: weight left to fill in
  ]);
  assert.equal(app.sessionToWorkout(session).routine, "A");
  assert.equal(app.sessionToWorkout({ ...session, routine: undefined }).routine, undefined);
  assert.equal(app.repeatLastWorkout([tagged("1", 1, "B")], plans).routine, "B");

  assert.deepEqual(app.saveRoutine([a, b], { name: " a ", exercises: ["Deadlift"] }), [{ name: "a", exercises: ["Deadlift"] }, b]);
  assert.deepEqual(app.saveRoutine([a], { name: "C", exercises: ["Deadlift"] }), [a, { name: "C", exercises: ["Deadlift"] }]);

  assert.deepEqual(app.parseRoutineTag("  [plan: Pull day: deadlift, Lat Pulldown (Cable), deadlift ]"), { name: "Pull day", exercises: ["Deadlift", "Lat Pulldown (Cable)"] });
  assert.equal(app.parseRoutineTag("Try [plan: A: Deadlift] next week"), null);
  assert.equal(app.parseRoutineTag("[video: Deadlift]"), null);

  const context = app.buildCoachContext({ ...settingsWith(), routines: [a, b] }, [tagged("1", 3, "A")], [], {}, null);
  assert.ok(context.includes(`WORKOUT PLANS (done in turn, next: B):\n- A: Bench Press (Dumbbell), Zercher Squat (last done ${daysAgo(3)})\n- B: Lat Pulldown (Cable)`));
  assert.ok(app.buildCoachContext(settingsWith(), [], [], {}, null).includes("WORKOUT PLANS (done in turn):\nnone saved"));
});

test("Onboarding: a new athlete is interviewed until a plan is saved or a workout logged, and the profile tag is checked", () => {
  const a = { name: "A", exercises: ["Goblet Squat"] };
  assert.equal(app.isNewAthlete(settingsWith(), []), true);
  assert.equal(app.isNewAthlete({ ...settingsWith(), routines: [a] }, []), false);
  assert.equal(app.isNewAthlete(settingsWith(), [userWorkout(daysAgo(3))]), false);
  assert.ok(app.buildCoachContext(settingsWith(), [], [], {}, null).includes("NEW ATHLETE"));
  assert.ok(!app.buildCoachContext({ ...settingsWith(), routines: [a] }, [], [], {}, null).includes("NEW ATHLETE"));

  assert.deepEqual(app.parseProfileTag(" [profile: name: Dana; experience: beginner; DAYSPERWEEK: 3; focus: fat loss; notes: home gym: dumbbells; music: rock] "), {
    name: "Dana", experience: "Beginner", daysPerWeek: 3, focus: "Fat loss", notes: "home gym: dumbbells", music: "rock",
  });
  assert.deepEqual(app.parseProfileTag("[profile: experience: Expert; daysPerWeek: 9; focus: ; unit: lb; constructor: x; music: jazz]"), { music: "jazz" }); // invalid or unknown: left out
  assert.equal(app.parseProfileTag("[profile: daysPerWeek: 2.5]"), null);
  assert.equal(app.parseProfileTag("Saved [profile: name: Dana]"), null);

  const { routines, ...noPlans } = settingsWith();
  assert.deepEqual(app.todayFacts({ workouts: [], settings: { ...noPlans, routines: [a] }, records: {}, plans: [] }).map((f) => f.text), ["Your first workout is ready: A."]);
});

test("Exercise photos: same name first (equipment in brackets or in front), then the AI's match, if it's a real photo", () => {
  assert.equal(app.photoFor("Leg Press"), "Leg_Press");
  assert.equal(app.photoFor("Bench Press (Dumbbell)"), "Dumbbell_Bench_Press");
  assert.equal(app.photoFor("goblet squat"), "Goblet_Squat");
  assert.equal(app.samePhoto("Seated Chest Fly (Machine)"), null);
  assert.equal(app.photoFor("Seated Chest Fly (Machine)", { "Seated Chest Fly (Machine)": "Butterfly" }), "Butterfly");
  assert.equal(app.photoFor("Seated Chest Fly (Machine)", { "Seated Chest Fly (Machine)": "Made_Up" }), null);
  assert.equal(app.photoFor("Leg Press", { "Leg Press": "Butterfly" }), "Leg_Press"); // the same name wins
});

test("Forecasts: dates, deadlines, and honest refusals", () => {
  const bench = (n, weight) => workout(`b${n}`, daysAgo(n), [ex("Bench Press (Dumbbell)", [[weight, 10]])]);
  const steady = [56, 49, 42, 35, 28, 21, 14, 7].map((n, i) => bench(n, 40 + i * 0.75)); // ~+1 kg est. 1RM a week
  const current = app.personalRecords(steady)["Bench Press (Dumbbell)"].e1rm;
  const goal = (target, deadlineInDays) => ({ exercise: "Bench Press (Dumbbell)", target, deadline: deadlineInDays ? daysAgo(-deadlineInDays) : "" });

  const behind = app.goalForecast(steady, goal(66, 28), current);
  assert.equal(behind.status, "forecast");
  assert.equal(behind.daysVsDeadline, 5);
  assert.equal(Math.round(behind.weeklyGain * 10) / 10, 1);
  assert.equal(Math.round(behind.neededWeeklyGain * 10) / 10, 1.2);
  assert.match(app.forecastText(behind, "kg"), /5 days after your deadline/);

  assert.equal(app.goalForecast(steady, goal(150), current).status, "far");
  assert.equal(app.goalForecast(steady.slice(-2), goal(62), current).status, "not-enough-data");
  assert.equal(app.goalForecast([42, 35, 28, 21, 14, 7].map((n) => bench(n, 44)), goal(62), 58.7).status, "flat");
  assert.equal(app.goalForecast(steady, goal(50), current).status, "reached");
});

test("Schedule and check-ins", () => {
  const at = (hour) => {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const day = new Date().getDay();
  const profile = (days, time = "18:00") => ({ trainingDays: days, trainingTime: time });
  const older = [workout("w", daysAgo(3), [ex("Bench Press", [[80, 8]])])];
  assert.equal(app.todayPlan(profile([day]), older, at(9)).status, "planned");
  assert.equal(app.todayPlan(profile([day]), older, at(21)).status, "late");
  assert.equal(app.todayPlan(profile([(day + 1) % 7]), older, at(9)).status, "rest");
  assert.equal(app.todayPlan(profile([day]), [...older, workout("t", daysAgo(0), [])], at(9)).status, "done");
  assert.equal(app.todayPlan(profile([]), older, at(9)).status, "unscheduled");

  const yesterday = workout("y", daysAgo(1), [ex("Bench Press", [[80, 8]])]);
  assert.equal(app.pendingCheckIn([...older, yesterday])?.id, "y");
  assert.equal(app.pendingCheckIn([...older, { ...yesterday, checkIn: { skipped: true } }]), null);
  assert.equal(app.pendingCheckIn(older), null); // 3 days ago is outside the window
});

test("Activities: pace per sport, cleaning parser output, weekly summary, training days", () => {
  const act = (type, minutes, distance, distanceUnit) => ({ id: `${type}${minutes}`, type, minutes, distance, distanceUnit, effort: null });
  assert.equal(app.paceText(act("Running", 28, 5, "km")), "5:36 /km");
  assert.equal(app.paceText(act("Swimming", 40, 1500, "m")), "2:40 /100 m");
  assert.equal(app.paceText(act("Rowing", 8, 2000, "m")), "2:00 /500 m");
  assert.equal(app.paceText(act("Cycling", 90, 42, "km")), "28 km/h");
  assert.equal(app.paceText(act("Yoga", 60, null, null)), "");

  const cleaned = app.sanitizeActivities({ activities: [
    { type: "running", minutes: 28, distance: 5, distanceUnit: "km", effort: "Moderate" },
    { type: "Spinning class", minutes: 45, effort: "Brutal" },
    { type: "Swimming", minutes: 0 },
  ] });
  assert.deepEqual(cleaned.map(({ id, ...a }) => a), [
    { type: "Running", minutes: 28, distance: 5, distanceUnit: "km", effort: "Moderate" },
    { type: "Other", minutes: 45, distance: null, distanceUnit: null, effort: null },
  ]);

  const entries = [
    workout("1", daysAgo(1), [], { activities: [act("Running", 28, 5, "km"), act("Yoga", 20, null, null)] }),
    workout("2", daysAgo(3), [], { activities: [act("Running", 32, 6, "km")] }),
    workout("3", daysAgo(3), [ex("Bench Press", [[80, 8]])]),
  ];
  assert.deepEqual(app.activitySummary(entries).map((s) => `${s.type}: ${app.summaryText(s)}`), ["Running: 2 sessions, 60 min, 11 km", "Yoga: 1 session, 20 min"]);
  assert.equal(app.lastGymWorkout(entries).id, "3");
  assert.equal(app.sessionsInWeekOf([workout("a", app.today(), []), workout("b", app.today(), [])], app.today()), 1);
});

test("Highlights: new bests, earned increases, longest activities", () => {
  const settings = settingsWith({ "Bench Press": [5, 8] });
  const earlier = [workout("e", daysAgo(7), [ex("Bench Press", [[80, 6]])], { activities: [{ type: "Running", minutes: 25, distance: 5, distanceUnit: "km" }] })];
  const facts = app.sessionHighlights(
    workout("n", app.today(), [ex("Bench Press", [[82.5, 8], [82.5, 8]])], { activities: [{ type: "Running", minutes: 33, distance: 6, distanceUnit: "km" }] }),
    earlier,
    settings
  ).map((f) => f.text);
  assert.ok(facts.some((t) => t.startsWith("New best on Bench Press")));
  assert.ok(facts.includes("Bench Press goes up to 85 kg next time."));
  assert.ok(facts.includes("Your longest run yet, beating 5 km."));
});

test("Version: the app shows the same version as package.json", async () => {
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(app.APP_VERSION, version);
});
