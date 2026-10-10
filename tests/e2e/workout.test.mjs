import { test } from "node:test";
import assert from "node:assert/strict";
import { openApp, section, stored, settle, exerciseNames, isCoachChat } from "./helpers.mjs";
import { userWorkout, settings } from "../fixtures.mjs";

test("live workout: start with Up next, reorder, check off, survive a reload, finish", async (t) => {
  const { page, errors } = await openApp(t, { seed: { "gymbot:workouts": [userWorkout] } });
  await page.getByRole("button", { name: /^Log/ }).tap();
  await page.getByRole("button", { name: /Start with Up next/ }).tap();
  const workout = section(page, "Workout");
  assert.equal((await exerciseNames(workout)).length, 7);

  await workout.getByRole("button", { name: "Reorder exercises" }).tap();
  for (let i = 0; i < 6; i++) await workout.getByRole("button", { name: "Move Hammer Curl (Dumbbell) up" }).tap();
  await workout.getByRole("button", { name: "Done", exact: true }).tap();
  assert.equal((await exerciseNames(workout))[0], "Hammer Curl (Dumbbell)");

  const first = workout.locator("ol > li").first();
  await first.getByRole("button", { name: "Set 1 done" }).tap();
  assert.match(await page.locator("div.fixed.top-0").innerText(), /Resting after Hammer Curl/);
  await page.getByRole("button", { name: "Skip" }).tap();

  await first.getByLabel("Set 2 weight").fill("8");
  await settle(page);
  await page.reload(); // like closing the app mid-workout
  await page.getByRole("button", { name: /^Log/ }).tap();
  assert.equal((await exerciseNames(workout))[0], "Hammer Curl (Dumbbell)");
  assert.equal(await first.getByRole("button", { name: "Set 1 done" }).getAttribute("aria-pressed"), "true");
  assert.equal(await first.getByLabel("Set 2 weight").inputValue(), "8");

  await first.getByRole("button", { name: "Mark all done" }).tap();
  await workout.getByRole("button", { name: /Finish and save/ }).tap();
  await settle(page);
  const saved = (await stored(page, "gymbot:workouts")).at(-1);
  assert.deepEqual(saved.exercises, [{ name: "Hammer Curl (Dumbbell)", sets: [{ weight: 7, reps: 8 }, { weight: 8, reps: 8 }, { weight: 7, reps: 8 }] }]);
  assert.ok(await section(page, "Session saved").isVisible());
  assert.deepEqual(errors, []);
});

test("finish by mistake: Continue this workout takes the saved workout back and reopens it as it was", async (t) => {
  const { page, errors } = await openApp(t, { seed: { "gymbot:workouts": [userWorkout] } });
  await page.getByRole("button", { name: /^Log/ }).tap();
  await page.getByRole("button", { name: /Start with Up next/ }).tap();
  const workout = section(page, "Workout");
  const names = await exerciseNames(workout);
  await workout.locator("ol > li").first().getByRole("button", { name: "Set 1 done" }).tap();
  await page.getByRole("button", { name: "Skip" }).tap();
  await workout.getByRole("button", { name: /Finish and save/ }).tap();
  await settle(page);
  assert.equal((await stored(page, "gymbot:workouts")).length, 2);

  await section(page, "Session saved").getByRole("button", { name: "Continue this workout" }).tap();
  assert.deepEqual(await exerciseNames(workout), names);
  assert.equal(await workout.locator("ol > li").first().getByRole("button", { name: "Set 1 done" }).getAttribute("aria-pressed"), "true");
  assert.equal(await section(page, "Session saved").count(), 0);
  await settle(page);
  assert.deepEqual(await stored(page, "gymbot:workouts"), [userWorkout]);
  assert.deepEqual(errors, []);
});

test("exercise picker: find an exercise by name, add it, then replace it with one for the same muscle", async (t) => {
  const { page, errors } = await openApp(t, { seed: { "gymbot:workouts": [userWorkout] } });
  await page.getByRole("button", { name: /^Log/ }).tap();
  await page.getByRole("button", { name: "Start an empty workout" }).tap();
  const workout = section(page, "Workout");

  await workout.getByRole("button", { name: "Add exercise" }).tap();
  const picker = page.getByRole("dialog", { name: "Add an exercise" });
  await picker.getByLabel("Search exercises").fill("bench");
  await picker.getByText("Bench Press", { exact: true }).tap();
  await workout.getByRole("button", { name: "Show details for Bench Press" }).waitFor();
  assert.equal(await picker.count(), 0);
  assert.deepEqual(await exerciseNames(workout), ["Bench Press"]);

  const card = workout.locator("ol > li").first();
  await card.getByLabel("Set 1 weight").fill("80");
  await card.getByRole("button", { name: "Set 1 done" }).tap();
  await page.getByRole("button", { name: "Skip" }).tap();
  await card.getByRole("button", { name: "Replace Bench Press" }).tap(); // the bench is taken
  const replacing = page.getByRole("dialog", { name: "Replace" });
  assert.equal(await replacing.getByRole("button", { name: "Chest", exact: true }).getAttribute("aria-pressed"), "true"); // alternatives without typing
  await replacing.getByLabel("Search exercises").fill("fly");
  assert.equal(await replacing.getByRole("button", { name: "Chest", exact: true }).getAttribute("aria-pressed"), "false"); // typing searches every muscle
  await replacing.getByText("Chest Fly (Dumbbell)", { exact: true }).tap();
  assert.deepEqual(await exerciseNames(workout), ["Bench Press", "Chest Fly (Dumbbell)"]); // the done set stays logged

  await workout.getByRole("button", { name: "Add exercise" }).tap();
  await picker.getByLabel("Search exercises").fill("pullup");
  assert.equal(await picker.getByRole("button", { name: /^Add “/ }).count(), 0); // Pull Up is listed, so no second spelling
  await picker.getByLabel("Search exercises").fill("landmine twist");
  await picker.getByLabel("Search exercises").press("Enter"); // nothing listed: adds the name as typed
  assert.deepEqual((await exerciseNames(workout)).at(-1), "Landmine Twist");
  assert.deepEqual(errors, []);
});

test("rest notes: the coach writes once per exercise while resting; Reply continues in the chat, Quiet stops it", async (t) => {
  let notes = 0;
  const { page, errors, aiRequests } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout] },
    ai: (body) => (body.system.includes("rest screen") ? `Note ${++notes}: slow on the way down.` : isCoachChat(body) ? "Good, keep it there." : "OK"),
  });
  await page.getByRole("button", { name: /^Log/ }).tap();
  await page.getByRole("button", { name: /Start with Up next/ }).tap();
  const items = section(page, "Workout").locator("ol > li");
  const bar = page.locator("div.fixed.top-0");

  await items.nth(0).getByRole("button", { name: "Set 1 done" }).tap();
  await bar.getByText("Note 1: slow on the way down.").waitFor();
  const asked = aiRequests.filter((b) => b.system.includes("rest screen"));
  assert.match(asked[0].messages[0].content, /^RESTING after set 1 of \d+ of /);
  assert.ok(asked[0].system.includes("WORKOUT IN PROGRESS"));
  await page.getByRole("button", { name: "Skip" }).tap();

  await items.nth(0).getByRole("button", { name: "Set 2 done" }).tap(); // same exercise: no new note
  await settle(page);
  assert.equal(await bar.getByRole("button", { name: "Reply" }).count(), 0);
  await page.getByRole("button", { name: "Skip" }).tap();

  await items.nth(1).getByRole("button", { name: "Set 1 done" }).tap();
  await bar.getByText("Note 2").waitFor();
  assert.ok(aiRequests.filter((b) => b.system.includes("rest screen"))[1].messages[0].content.includes("You already said this workout:\n- Note 1"));
  await bar.getByRole("button", { name: "Reply" }).tap();
  await page.getByText("Note 2: slow on the way down.").last().waitFor(); // in the chat now
  await page.getByPlaceholder("Message your coach").fill("Felt heavy");
  await page.getByRole("button", { name: "Send" }).tap();
  await page.getByText("Good, keep it there.").waitFor();
  assert.ok(aiRequests.find(isCoachChat).system.includes("between sets"));

  await page.getByRole("button", { name: "Skip" }).tap();
  await page.getByRole("button", { name: /^Log/ }).tap();
  await items.nth(2).getByRole("button", { name: "Set 1 done" }).tap();
  await bar.getByText("Note 3").waitFor();
  assert.ok(aiRequests.filter((b) => b.system.includes("rest screen"))[2].messages[0].content.includes("- athlete: Felt heavy")); // picks up the chat

  await bar.getByRole("button", { name: "Quiet" }).tap();
  assert.equal(await bar.getByText("Note 3").count(), 0);
  await page.getByRole("button", { name: "Skip" }).tap();
  await items.nth(3).getByRole("button", { name: "Set 1 done" }).tap();
  await settle(page);
  assert.equal(aiRequests.filter((b) => b.system.includes("rest screen")).length, 3);
  assert.deepEqual(errors, []);
});

test("exercise photos: known names right away, others matched once by the AI and kept; details show start and finish", async (t) => {
  const rare = { id: "rare", date: "2026-10-01", notes: "", exercises: ["Zottman Curl (Dumbbell)", "Made Up Lift"].map((name) => ({ name, sets: [{ weight: 12, reps: 10 }] })) };
  const { page, errors, aiRequests } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout, rare] },
    ai: (body) => (body.system.startsWith("Match each exercise") ? '{"Zottman Curl (Dumbbell)":"Zottman_Curl","Made Up Lift":"Made_Up"}' : "OK"),
  });
  await page.getByRole("button", { name: "Log", exact: true }).tap();
  await page.getByRole("button", { name: /^Show all/ }).tap();
  const photo = (name) => page.getByRole("button", { name: `Show details for ${name}` }).first().locator("img");
  await photo("Zottman Curl (Dumbbell)").waitFor();
  assert.equal(await photo("Zottman Curl (Dumbbell)").getAttribute("src"), "/exercises/Zottman_Curl-0.webp");
  assert.equal(await photo("Bench Press (Dumbbell)").getAttribute("src"), "/exercises/Dumbbell_Bench_Press-0.webp"); // same name
  assert.equal(await photo("Seated Chest Fly (Machine)").getAttribute("src"), "/exercises/Butterfly-0.webp"); // reviewed list
  assert.equal(await photo("Made Up Lift").count(), 0); // not a real photo: the muscle figure stays
  await settle(page);
  assert.deepEqual(await stored(page, "gymbot:exercise-photos"), { "Zottman Curl (Dumbbell)": "Zottman_Curl", "Made Up Lift": null }); // null is kept too
  const asked = aiRequests.filter((b) => b.system.startsWith("Match each exercise"));
  assert.deepEqual(asked.map((b) => b.messages[0].content.split("\n").sort()), [["Made Up Lift", "Zottman Curl (Dumbbell)"]]); // known names are never asked

  await page.reload();
  await page.getByRole("button", { name: "Log", exact: true }).tap();
  await page.getByRole("button", { name: "Show details for Seated Chest Fly (Machine)" }).first().tap();
  const sheet = page.getByRole("dialog");
  assert.deepEqual(await sheet.locator("img").evaluateAll((imgs) => Promise.all(imgs.map(async (i) => (await i.decode(), [i.alt, i.naturalWidth > 0])))), [
    ["Seated Chest Fly (Machine): start", true],
    ["Seated Chest Fly (Machine): finish", true],
  ]);
  assert.equal(aiRequests.filter((b) => b.system.startsWith("Match each exercise")).length, 1); // not asked again after the reload
  assert.deepEqual(errors, []);
});

test("history: folded by default, then edit a saved workout", async (t) => {
  const { page, errors } = await openApp(t, { seed: { "gymbot:workouts": [userWorkout] } });
  await page.getByRole("button", { name: /^Log/ }).tap();
  const history = section(page, /^History/);
  const toggle = history.getByRole("button", { name: /^History/ });
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");

  await toggle.tap();
  await history.getByRole("button", { name: /Sep 23/ }).tap();
  await history.getByRole("button", { name: "Edit" }).tap();
  await history.locator("ol > li").first().getByLabel("Set 3 reps").fill("5");
  await history.getByRole("button", { name: "Save changes" }).tap();
  await settle(page);
  const saved = (await stored(page, "gymbot:workouts"))[0];
  assert.equal(saved.id, "sep23");
  assert.deepEqual(saved.exercises[0].sets.at(-1), { weight: 32, reps: 5 });
  assert.deepEqual(errors, []);
});

test("workout plans: the next one starts in a tap, a workout saves over a plan, the coach suggests one", async (t) => {
  const a = { name: "A", exercises: ["Bench Press (Dumbbell)", "Front Squat (Kettlebell)"] };
  const b = { name: "B", exercises: ["Lat Pulldown (Cable)", "Seated Row (Close Grip) (Machine)", "Hammer Curl (Dumbbell)"] };
  const { page, errors, aiRequests } = await openApp(t, {
    seed: { "gymbot:workouts": [{ ...userWorkout, routine: "A" }], "gymbot:settings": { ...settings(), routines: [a, b] } },
    ai: (body) => (isCoachChat(body) ? "Add legs to B.\n[plan: B: Lat Pulldown (Cable), back squat]" : "OK"),
  });
  await page.getByRole("button", { name: /^Log/ }).tap();
  const start = section(page, "Start a workout");
  assert.match(await start.locator("li", { hasText: "Next" }).innerText(), /^B/);
  await start.getByRole("button", { name: "Start plan B" }).tap();
  const workout = section(page, "Workout B");
  assert.deepEqual(await exerciseNames(workout), b.exercises);
  assert.equal(await workout.locator("ol > li").first().getByLabel("Set 1 weight").inputValue(), "45"); // Autopilot's target

  await workout.getByRole("button", { name: "Remove Hammer Curl (Dumbbell)" }).tap();
  await workout.getByRole("button", { name: "Save as a plan" }).tap();
  assert.equal(await workout.getByLabel("Plan name").inputValue(), "B");
  await workout.getByRole("button", { name: "Save", exact: true }).tap();
  await workout.getByText("Saved as plan B").waitFor();

  await page.getByRole("button", { name: "Coach", exact: true }).tap();
  await page.getByPlaceholder("Message your coach").fill("fix my plans");
  await page.getByRole("button", { name: "Send" }).tap();
  await page.getByRole("button", { name: "Save plan B" }).tap();
  await settle(page);
  assert.deepEqual((await stored(page, "gymbot:settings")).routines, [a, { name: "B", exercises: ["Lat Pulldown (Cable)", "Back Squat"] }]);
  assert.match(aiRequests.find(isCoachChat).system, /WORKOUT PLANS \(done in turn, next: B\):\n- A: .*\(last done 2026-09-23\)\n- B: Lat Pulldown \(Cable\), Seated Row \(Close Grip\) \(Machine\)\n/);
  assert.deepEqual(errors, []);
});
