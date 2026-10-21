import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { COMMIT, openApp, section, settle, stored } from "./helpers.mjs";
import { userWorkout, settings } from "../fixtures.mjs";

test("export: every gymbot key as one JSON object, next to the app version and commit", async (t) => {
  const seed = { "gymbot:workouts": [userWorkout], "gymbot:settings": settings() };
  const { page, errors } = await openApp(t, { seed });
  await page.getByRole("button", { name: "Goals", exact: true }).tap();
  const { version } = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  await page.getByText(`MyGymBot ${version} ${COMMIT}`).waitFor();
  assert.equal(await page.getByText("not medical advice").count(), 2); // under Injuries and at the bottom
  await page.getByRole("button", { name: "Export data" }).tap();
  const exported = JSON.parse(await page.getByLabel("Exported data").inputValue());
  assert.deepEqual(exported["gymbot:workouts"], seed["gymbot:workouts"]);
  assert.deepEqual(exported["gymbot:settings"], seed["gymbot:settings"]);
  assert.deepEqual(errors, []);
});

test("food: a typed meal is drafted by the AI, answered, corrected and saved; protein counts toward the target", async (t) => {
  const per = (protein, carbs, fat, kcal) => ({ protein, carbs, fat, kcal });
  const draft = {
    name: "Chicken rice bowl",
    items: [{ name: "Chicken breast", grams: 150, per100: per(31, 0, 3.6, 165) }, { name: "Rice", grams: 200, per100: per(2.5, 28, 0.3, 130) }],
    question: { text: "Cooked in oil?", options: [{ label: "No", add: null }, { label: "A little", add: { name: "Olive oil", grams: 10, per100: per(0, 0, 100, 884) } }] },
  };
  const { page, errors, aiRequests } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout], "gymbot:bodyweight": [{ date: "2026-10-01", weight: 80 }] },
    ai: (body) => (body.system.startsWith("You estimate what is in a meal") ? JSON.stringify(draft) : "OK"),
  });
  await page.getByRole("button", { name: "Food", exact: true }).tap();
  await page.getByText("of 128 g protein today").waitFor(); // 1.6 g per kg of 80 kg
  await page.getByLabel("What did you eat?").fill("chicken and rice");
  await page.getByRole("button", { name: "Add", exact: true }).tap();
  await page.getByText("Cooked in oil?").waitFor();
  assert.match(aiRequests.at(-1).messages[0].content, /chicken and rice/);
  await page.getByRole("button", { name: "A little" }).tap();
  await page.getByText("Olive oil").waitFor();
  await page.getByLabel("Chicken breast grams").fill("200"); // the photo guessed small
  await page.getByText("67 g protein").waitFor(); // 62 + 5
  await page.getByRole("button", { name: "Save meal" }).tap();
  await section(page, "Today").getByText("Chicken rice bowl").waitFor();
  await page.getByText("67", { exact: true }).waitFor(); // the day's protein
  await settle(page);
  const [meal] = await stored(page, "gymbot:food");
  assert.equal(meal.date, "2026-10-03");
  assert.deepEqual(meal.items.map((i) => [i.name, i.grams]), [["Chicken breast", 200], ["Rice", 200], ["Olive oil", 10]]);
  assert.equal(meal.question, undefined); // the question isn't stored

  await section(page, "Today").getByText("Chicken rice bowl").tap(); // a saved meal opens to edit or delete
  await page.getByRole("button", { name: "Delete this meal" }).tap();
  await page.getByRole("button", { name: "Tap again to delete" }).tap();
  await section(page, "Today").waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
});

const egg = { name: "Eggs", grams: 100, per100: { protein: 13, carbs: 1, fat: 10, kcal: 155 } };
const breakfast = (date) => ({ id: date, date, time: "08:00", name: "Eggs", items: [egg] });

test("food: a photo goes to the AI as a JPEG; a meal logged 3 times becomes a one-tap button", async (t) => {
  const { page, errors, aiRequests } = await openApp(t, {
    seed: { "gymbot:food": ["2026-09-30", "2026-10-01", "2026-10-02"].map(breakfast), "gymbot:settings": { ...settings(), tourSeen: true } },
    ai: (body) => (body.system.startsWith("You estimate what is in a meal") ? JSON.stringify({ name: "Eggs", items: [egg], question: null }) : "OK"),
  });
  await page.getByRole("button", { name: "Food", exact: true }).tap();
  await page.getByRole("button", { name: "Eggs, 13 g" }).tap(); // usual meal: logged now, no AI
  await section(page, "Today").getByText("Eggs").waitFor();
  assert.equal(aiRequests.length, 0);
  assert.equal(await page.getByLabel("Snap a meal").getAttribute("capture"), "environment"); // opens the camera
  assert.equal(await page.getByLabel("Or choose a photo").getAttribute("capture"), null); // the phone's photos
  await page.getByLabel("Or choose a photo").setInputFiles({ name: "plate.png", mimeType: "image/png", buffer: Buffer.from(PNG_1PX, "base64") });
  await page.getByRole("button", { name: "Save meal" }).waitFor();
  const [message] = aiRequests.at(-1).messages;
  assert.equal(message.images.length, 1);
  assert.ok(Buffer.from(message.images[0], "base64").subarray(0, 2).equals(Buffer.from([0xff, 0xd8])));
  assert.deepEqual(errors, []);
});

test("food: past days open by day, and a past meal is corrected", async (t) => {
  const { page, errors } = await openApp(t, {
    seed: { "gymbot:food": ["2026-09-22", "2026-09-30", "2026-10-01", "2026-10-02"].map(breakfast), "gymbot:settings": { ...settings(), tourSeen: true } },
  });
  await page.getByRole("button", { name: "Food", exact: true }).tap();
  const past = section(page, /^Past days/);
  const toggle = past.getByRole("button", { name: /^Past days/ });
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.match(await toggle.textContent(), /4 days/);

  await toggle.tap();
  const days = past.getByRole("button", { name: /protein, about/ });
  await days.first().waitFor();
  const rows = await days.allTextContents(); // each is the date, then "13 g protein, about 155 kcal"
  assert.deepEqual(rows.map((row) => row.replace("13 g protein, about 155 kcal", "")), ["Fri, Oct 2", "Thu, Oct 1", "Wed, Sep 30", "Tue, Sep 22"]); // newest first

  await past.getByRole("button", { name: /^Thu, Oct 1/ }).tap();
  await past.getByRole("button", { name: /Eggs/ }).tap(); // opens the editor at the top
  await page.getByText("Thu, Oct 1, 08:00").waitFor(); // which day the meal is from, under today's protein
  await page.getByLabel("Eggs grams").fill("200");
  await page.getByRole("button", { name: "Save meal" }).tap();
  await past.getByText("26 g protein, about 310 kcal").waitFor();
  await settle(page);
  const saved = (await stored(page, "gymbot:food")).find((meal) => meal.id === "2026-10-01");
  assert.deepEqual([saved.date, saved.time, saved.items[0].grams], ["2026-10-01", "08:00", 200]); // still that day
  await section(page, "Protein a day, by week").locator("svg.recharts-surface").waitFor(); // two weeks with meals
  assert.deepEqual(errors, []);
});

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("bodyweight: logged in Progress, one entry per day, charted with the change", async (t) => {
  const { page, errors } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout], "gymbot:bodyweight": [{ date: "2026-09-20", weight: 82.5 }] },
  });
  await page.getByRole("button", { name: "Progress", exact: true }).tap();
  const panel = section(page, "Bodyweight");
  await panel.getByLabel("Today's weight").fill("81");
  await panel.getByRole("button", { name: "Log" }).tap();
  await panel.getByLabel("Today's weight").fill("80.5");
  await panel.getByLabel("Today's weight").press("Enter");
  await panel.getByText("Now 80.5 kg, down 2 kg since").waitFor();
  await panel.locator("svg.recharts-surface").waitFor(); // the chart draws after it measures its box
  await settle(page);
  assert.deepEqual(await stored(page, "gymbot:bodyweight"), [{ date: "2026-09-20", weight: 82.5 }, { date: "2026-10-03", weight: 80.5 }]);
  assert.deepEqual(errors, []);
});

test("saves: a failed save shows Not saved yet, is retried, and the newest value lands", async (t) => {
  const { page, errors } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout], "gymbot:bodyweight": [{ date: "2026-09-20", weight: 82.5 }] },
  });
  const offline = (route) => (route.request().method() === "PUT" ? route.abort() : route.continue());
  await page.route("**/api/storage/**", offline);
  await page.getByRole("button", { name: "Progress", exact: true }).tap();
  const panel = section(page, "Bodyweight");
  await panel.getByLabel("Today's weight").fill("81");
  await panel.getByRole("button", { name: "Log" }).tap();
  const banner = page.getByRole("status").filter({ hasText: "Not saved yet" });
  await banner.waitFor();
  await panel.getByLabel("Today's weight").fill("80.5");
  await panel.getByRole("button", { name: "Log" }).tap();
  await settle(page);

  await page.unroute("**/api/storage/**", offline);
  await banner.waitFor({ state: "detached", timeout: 15000 });
  assert.deepEqual(await stored(page, "gymbot:bodyweight"), [{ date: "2026-09-20", weight: 82.5 }, { date: "2026-10-03", weight: 80.5 }]);
  assert.deepEqual(errors, []);
});

test("errors: an uncaught error in the app is reported to the server once", async (t) => {
  const { page, errors } = await openApp(t, { seed: { "gymbot:workouts": [userWorkout] } });
  const reports = [];
  page.on("request", (request) => request.url().endsWith("/api/errors") && reports.push(request.postDataJSON()));
  const report = page.waitForRequest("**/api/errors");
  for (let i = 0; i < 2; i++) await page.addScriptTag({ content: 'throw new Error("boom");' }); // twice, reported once
  await report;
  await settle(page);
  assert.equal(reports.length, 1);
  assert.match(reports[0].message, /boom/);
  assert.equal(reports[0].version, JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")).version);
  assert.deepEqual(errors, ["boom", "boom"]);
});

test("feedback: sent from Goals with the app version", async (t) => {
  const { page, errors } = await openApp(t, { seed: { "gymbot:workouts": [userWorkout] } });
  await page.getByRole("button", { name: "Goals", exact: true }).tap();
  const panel = section(page, "Feedback");
  assert.ok(await panel.getByRole("button", { name: "Send feedback" }).isDisabled());
  await panel.getByLabel("Feedback").fill("The rest timer should vibrate");
  const request = page.waitForRequest("**/api/feedback");
  await panel.getByRole("button", { name: "Send feedback" }).tap();
  const { version } = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.deepEqual((await request).postDataJSON(), { text: "The rest timer should vibrate", version });
  await panel.getByText("Sent. Thank you.").waitFor();
  assert.equal(await panel.getByLabel("Feedback").inputValue(), "");
  assert.deepEqual(errors, []);
});

test("saves: a save the server refuses is not retried; the app asks for a reload", async (t) => {
  const { page, errors } = await openApp(t, { seed: { "gymbot:workouts": [userWorkout] } });
  const puts = [];
  await page.route("**/api/storage/**", (route) =>
    route.request().method() === "PUT" ? (puts.push(route.request().url()), route.fulfill({ status: 401 })) : route.continue()
  );
  await page.getByRole("button", { name: "Progress", exact: true }).tap();
  const panel = section(page, "Bodyweight");
  await panel.getByLabel("Today's weight").fill("81");
  await panel.getByRole("button", { name: "Log" }).tap();
  await page.getByRole("status").filter({ hasText: "Not saved. Reload the app." }).waitFor();
  await page.waitForTimeout(2500); // longer than the first retry would wait
  assert.ok(puts.some((url) => url.includes("bodyweight")));
  assert.equal(new Set(puts).size, puts.length); // each key tried once, never again
  assert.deepEqual(errors, []);
});
