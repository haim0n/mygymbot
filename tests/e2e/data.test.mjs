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
  await page.getByText(`GymBot ${version} ${COMMIT}`).waitFor();
  await page.getByRole("button", { name: "Export data" }).tap();
  const exported = JSON.parse(await page.getByLabel("Exported data").inputValue());
  assert.deepEqual(exported["gymbot:workouts"], seed["gymbot:workouts"]);
  assert.deepEqual(exported["gymbot:settings"], seed["gymbot:settings"]);
  assert.deepEqual(errors, []);
});

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
