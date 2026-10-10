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
import * as photos from "../src/exercise-photos.js";
import * as photoMatches from "../src/photo-matches.js";

const app = { ...config, ...dates, ...training, ...autopilot, ...motivation, ...muscles, ...liveWorkout, ...schedule, ...activities, ...importing, ...coach_context, ...photos, ...photoMatches };

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

test("Coach context: age, sex, height and session length are added only when the athlete filled them in", () => {
  const profile = { unit: "kg", experience: "Intermediate", daysPerWeek: 3, focus: "Strength" };
  const athleteLine = (extra) => app.buildCoachContext({ profile: { ...profile, ...extra }, goals: [] }, [], [], {}, null).split("\n\n").find((block) => block.startsWith("ATHLETE:"));
  const age = Number(app.today().slice(0, 4)) - 1985;
  assert.match(athleteLine({ sex: "Male", birthYear: "1985", height: "180", sessionMinutes: "60" }), new RegExp(`^ATHLETE: Intermediate, male, age ${age}, height 180cm, bodyweight unknownkg, aims for 3 sessions/week, sessions of up to 60 min, focus`));
  assert.match(athleteLine({ unit: "lb", height: "70" }), /^ATHLETE: Intermediate, height 70in, bodyweight/);
  assert.match(athleteLine({ sex: "", birthYear: "", height: "", sessionMinutes: "" }), /^ATHLETE: Intermediate, bodyweight unknownkg, aims for 3 sessions\/week, focus/);
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

test("Exercise picker: finds yours first, then common names, then the library; replacing keeps the place and the done sets", () => {
  const yours = ["Bench Press (Dumbbell)", "Zercher Squat"];
  const found = (query, options) => app.searchExercises(query, yours, options);
  assert.deepEqual(found("").slice(0, 3), ["Bench Press (Dumbbell)", "Zercher Squat", "Bench Press"]); // the library waits for a search
  assert.ok(!found("").includes("Yoke Walk"));
  assert.deepEqual(found("bench").slice(0, 3), ["Bench Press (Dumbbell)", "Bench Press", "Incline Bench Press"]);
  assert.ok(found("pull up").includes("Pull Up") && found("pullup").includes("Pull Up"));
  assert.ok(found("yoke").includes("Yoke Walk"));
  assert.ok(found("chin").includes("Chin-Up") && !found("chin").some((name) => /machine/i.test(name))); // words start, not letters anywhere
  assert.ok(found("lat pull").includes("Lat Pulldown"));
  const lats = found("", { muscle: "lats" });
  assert.ok(lats.indexOf("Pull Up") < lats.indexOf("Barbell Row")); // works the lats first, ahead of rows
  assert.equal(found("zercher").filter((name) => name.toLowerCase() === "zercher squat").length, 1); // yours and the common name are one
  assert.deepEqual(found("xyzzy"), []);
  assert.ok(found("", { muscle: "chest" }).every((name) => app.musclesFor(name, {}).primary.includes("chest")));
  assert.equal(app.searchExercises("", ["Landmine Press"], { muscle: "chest", learnedMuscles: { "Landmine Press": { primary: ["chest"], secondary: [] } } })[0], "Landmine Press");
  assert.equal(found("", { muscle: "chest" })[0], "Bench Press (Dumbbell)");
  assert.equal(found("").length, app.EXERCISE_SEARCH_LIMIT);

  const plans = app.buildAutopilotPlans([userWorkout(daysAgo(3))], settingsWith());
  let session = app.routineSession({ name: "A", exercises: ["Zercher Squat", "Deadlift"] }, plans);
  const [squat, deadlift] = session.exercises;
  const sets = (s) => s.exercises.map((e) => [e.name, e.sets.map((x) => [x.weight, x.reps, x.done])]);
  assert.deepEqual(sets(app.replaceExercise(session, squat.id, "Goblet Squat", plans)), [
    ["Goblet Squat", [["", 8, false], ["", 8, false], ["", 8, false]]],
    ["Deadlift", [["", 8, false], ["", 8, false], ["", 8, false]]],
  ]);
  assert.deepEqual(sets(app.replaceExercise(session, squat.id, "Bench Press (Dumbbell)", plans))[0], ["Bench Press (Dumbbell)", [[44, 10, false], [44, 10, false]]]); // its Autopilot target

  session = app.toggleSet(session, squat.id, squat.sets[0].id);
  session = app.editSet(session, squat.id, squat.sets[0].id, "weight", "60");
  session = app.replaceExercise(session, squat.id, "Leg Press", plans);
  assert.deepEqual(sets(session), [
    ["Zercher Squat", [["60", 8, true]]], // done before the machine was taken: still logged
    ["Leg Press", [["", 8, false], ["", 8, false]]],
    ["Deadlift", [["", 8, false], ["", 8, false], ["", 8, false]]],
  ]);
  assert.equal(session.exercises[2].id, deadlift.id);
});

test("Set feel: too easy or too hard moves the next sets at that weight; it is saved, and too hard holds Autopilot", () => {
  let session = { ...app.startSession(), exercises: [app.sessionExercise("Bench Press", [{ weight: 80, reps: 8 }, { weight: 80, reps: 8 }, { weight: 80, reps: 8 }, { weight: 60, reps: 12 }]), app.sessionExercise("Push Up", [{ weight: 0, reps: 10 }, { weight: 0, reps: 10 }])] };
  const [bench, pushUp] = session.exercises;
  const sets = (s, i) => s.exercises[i].sets.map((x) => [x.weight, x.reps, x.feel]);
  session = app.toggleSet(session, bench.id, bench.sets[0].id);
  assert.deepEqual(app.nextSet(session, bench.id).set.id, bench.sets[1].id);

  const easy = app.rateSet(session, bench.id, bench.sets[0].id, "easy", "kg");
  assert.deepEqual(sets(easy, 0), [[80, 8, "easy"], [82.5, 8, undefined], [82.5, 8, undefined], [60, 12, undefined]]); // the drop set stays
  assert.deepEqual(sets(app.rateSet(session, bench.id, bench.sets[0].id, "hard", "kg"), 0).slice(0, 2), [[80, 8, "hard"], [77.5, 8, undefined]]);
  assert.deepEqual(sets(app.rateSet(session, bench.id, bench.sets[0].id, "right", "kg"), 0).slice(0, 2), [[80, 8, "right"], [80, 8, undefined]]);
  assert.deepEqual(sets(app.rateSet(session, pushUp.id, pushUp.sets[0].id, "easy", "kg"), 1), [[0, 10, "easy"], [0, 12, undefined]]); // reps without weight
  assert.equal(app.feelResult(easy.exercises[0], easy.exercises[0].sets[0], "kg"), "Too easy: the next sets go up.");
  const lastOf80 = app.rateSet(app.toggleSet(app.toggleSet(session, bench.id, bench.sets[1].id), bench.id, bench.sets[2].id), bench.id, bench.sets[2].id, "easy", "kg");
  assert.equal(app.feelResult(lastOf80.exercises[0], lastOf80.exercises[0].sets[2], "kg"), "Too easy: noted."); // only the drop set is left, and it stays
  const offGrid = { ...session, exercises: [{ ...bench, sets: bench.sets.map((x) => ({ ...x, weight: 81 })) }] };
  assert.equal(app.rateSet(offGrid, bench.id, bench.sets[0].id, "hard", "kg").exercises[0].sets[1].weight, 80); // onto a weight that exists

  const next = (name, weight, reps = 5) => app.describeNextSet({ exercise: { name }, set: { weight, reps } }, "kg");
  assert.equal(next("Bench Press", 82.5), "82.5 kg × 5. Per side: 25, 5, 1.25");
  assert.equal(next("Back Squat", 20), "20 kg × 5. Empty bar");
  assert.equal(next("Leg Press (Machine)", 120), "120 kg × 5"); // a sled, no bar
  assert.equal(next("Bench Press (Dumbbell)", 30), "30 kg × 5");
  assert.equal(next("Push Up", 0, 12), "12 reps");

  let done = app.completeExercise(easy, bench.id);
  assert.equal(app.nextSet(done, bench.id).exercise.id, pushUp.id); // then the next exercise
  done = app.completeExercise(done, pushUp.id);
  assert.equal(app.nextSet(done, bench.id), null);
  const saved = app.sessionToWorkout(done);
  assert.deepEqual(saved.exercises[0].sets[0], { weight: 80, reps: 8, feel: "easy" });
  assert.equal(app.workoutToSession(saved).exercises[0].sets[0].feel, "easy"); // kept when a saved workout is fixed
  assert.equal(app.repeatLastWorkout([{ ...saved, date: daysAgo(1) }], []).exercises[0].sets[0].feel, undefined); // a new workout starts unrated
  assert.equal(
    app.finishedWorkoutRequest(saved, 48, [{ tone: "celebrate", text: "New best on Bench Press." }], "kg"),
    "FINISHED WORKOUT (48 min):\n- Bench Press: 80×8, 82.5×8, 82.5×8, 60×12 (felt too easy)\n- Push Up: 2×10 @ BW\nHIGHLIGHTS:\n- New best on Bench Press."
  );

  const benchWith = (feel) => [workout("1", daysAgo(3), [ex("Bench Press", [[80, 8], [80, 8], [80, 8]])].map((e) => ({ ...e, sets: e.sets.map((x, i) => (i === 2 && feel ? { ...x, feel } : x)) })))];
  const planWith = (feel) => planFor(app.buildAutopilotPlans(benchWith(feel), settingsWith({ "Bench Press": [5, 8] })), "Bench Press");
  assert.deepEqual(planWith("hard"), { status: "hold", sets: 3, reps: 8, weight: 80 });
  assert.equal(planWith("easy").status, "increase");
  assert.equal(planWith(null).status, "increase");
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
  assert.deepEqual(app.parseProfileTag("[profile: sessionMinutes: 45]"), { sessionMinutes: 45 });
  assert.equal(app.parseProfileTag("[profile: sessionMinutes: 45 min]"), null);
  assert.equal(app.parseProfileTag("[profile: sessionMinutes: 5]"), null);
  assert.equal(app.parseProfileTag("Saved [profile: name: Dana]"), null);

  const { routines, ...noPlans } = settingsWith();
  assert.deepEqual(app.todayFacts({ workouts: [], settings: { ...noPlans, routines: [a] }, records: {}, plans: [] }).map((f) => f.text), ["Your first workout is ready: A."]);
});

test("Coach memory: remember tags add facts, replace or drop copies of old ones, and the coach sees them", () => {
  const knee = { text: "Left knee hurts on squats", date: "2026-10-01" };
  const facts = [knee, { text: "Prefers dumbbells", date: "2026-10-02" }];
  assert.deepEqual(app.parseMemoryTag(" [remember: Knee is fine now | replaces: Left knee hurts on squats] "), { text: "Knee is fine now", replaces: "Left knee hurts on squats" });
  assert.deepEqual(app.parseMemoryTag("[Remember: Trains for a 10k in May]"), { text: "Trains for a 10k in May", replaces: null });
  assert.equal(app.parseMemoryTag("[remember: Knee is fine | replaces: Left knee hurts on squats (2026-10-01)]").replaces, "Left knee hurts on squats"); // as listed in the context
  assert.equal(app.parseMemoryTag("I'll [remember: this]"), null);

  assert.equal(app.rememberFacts(facts, "Good set.\nKeep going.", "2026-10-08"), facts); // nothing remembered: the same list, so nothing is saved
  assert.deepEqual(app.rememberFacts(facts, "Glad.\n[remember: Knee is fine now | replaces: left knee hurts on squats.]\n[remember: prefers Dumbbells]", "2026-10-08"), [
    { text: "Knee is fine now", date: "2026-10-08" },
    { text: "prefers Dumbbells", date: "2026-10-08" },
  ]);
  const many = Array.from({ length: app.MAX_COACH_FACTS }, (_, i) => ({ text: `Fact ${i}`, date: "2026-10-01" }));
  const capped = app.rememberFacts(many, "[remember: New fact]", "2026-10-08");
  assert.equal(capped.length, app.MAX_COACH_FACTS);
  assert.deepEqual([capped[0].text, capped.at(-1).text], ["Fact 1", "New fact"]); // the oldest goes

  const context = (coachMemory) => app.buildCoachContext({ ...settingsWith(), coachMemory }, [], [], {}, null);
  assert.ok(context(facts).includes("WHAT YOU KNOW ABOUT THE ATHLETE (they told you in earlier chats, oldest first):\n- Left knee hurts on squats (2026-10-01)\n- Prefers dumbbells (2026-10-02)"));
  assert.ok(!context(undefined).includes("WHAT YOU KNOW")); // settings saved before the field existed
});

test("Exercise photos: same name first (equipment in brackets or in front), then the AI's match, if it's a real photo", () => {
  assert.equal(app.photoFor("Leg Press"), "Leg_Press");
  assert.equal(app.photoFor("Bench Press (Dumbbell)"), "Dumbbell_Bench_Press");
  assert.equal(app.photoFor("goblet squat"), "Goblet_Squat");
  assert.equal(app.knownPhoto("seated row (close grip) (machine)"), "Leverage_Iso_Row"); // the reviewed list
  assert.equal(app.knownPhoto("Mountain Climber"), null); // listed: no photo fits, so the AI isn't asked
  assert.equal(app.knownPhoto("Zottman Curl (Dumbbell)"), undefined);
  assert.equal(app.photoFor("Zottman Curl (Dumbbell)", { "Zottman Curl (Dumbbell)": "Zottman_Curl" }), "Zottman_Curl");
  assert.equal(app.photoFor("Zottman Curl (Dumbbell)", { "Zottman Curl (Dumbbell)": "Made_Up" }), null);
  assert.equal(app.photoFor("Leg Press", { "Leg Press": "Butterfly" }), "Leg_Press"); // known wins over the AI
  const photos = new Set(app.EXERCISE_PHOTOS);
  assert.deepEqual(Object.values(app.PHOTO_MATCHES).filter((id) => id !== null && !photos.has(id)), []); // every match is a real photo
});

test("Rest notes: once per exercise, never when quiet, and the coach hears the set and what it already said", () => {
  const session = { exercises: [{ name: "Leg Press", sets: [{ weight: 100, reps: 10, done: true }, { weight: 100, reps: 10, done: false }] }] };
  assert.equal(app.wantsRestNote(session, "Leg Press"), true);
  assert.equal(app.wantsRestNote(null, "Leg Press"), false);
  assert.equal(app.restNoteRequest(session, "Leg Press"), "RESTING after set 1 of 2 of Leg Press (100x10).\nWrite a cue for the next set.");
  const noted = { ...session, coachNotes: [{ exercise: "Leg Press", text: "Drive through the heels." }] };
  assert.equal(app.wantsRestNote(noted, "Leg Press"), false);
  assert.equal(app.wantsRestNote(noted, "Leg Extension"), true);
  assert.equal(app.wantsRestNote({ ...session, coachQuiet: true }, "Leg Extension"), false);
  assert.ok(app.restNoteRequest(noted, "Leg Press").includes("Write a quick question")); // the next kind in turn
  assert.ok(app.restNoteRequest(noted, "Leg Press").endsWith("You already said this workout:\n- Drive through the heels."));
  const chat = [{ role: "assistant", content: "How did it feel?" }, { role: "user", content: "Heavy, my knee aches" }];
  assert.ok(app.restNoteRequest(session, "Leg Press", chat).includes("LATEST COACH CHAT (oldest first):\n- coach: How did it feel?\n- athlete: Heavy, my knee aches"));
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
