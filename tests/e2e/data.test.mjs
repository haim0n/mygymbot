import { test } from "node:test";
import assert from "node:assert/strict";
import { openApp } from "./helpers.mjs";
import { userWorkout, settings } from "../fixtures.mjs";

test("export: every gymbot key as one JSON object", async (t) => {
  const seed = { "gymbot:workouts": [userWorkout], "gymbot:settings": settings() };
  const { page, errors } = await openApp(t, { seed });
  await page.getByRole("button", { name: "Goals", exact: true }).tap();
  await page.getByRole("button", { name: "Export data" }).tap();
  const exported = JSON.parse(await page.getByLabel("Exported data").inputValue());
  assert.deepEqual(exported["gymbot:workouts"], seed["gymbot:workouts"]);
  assert.deepEqual(exported["gymbot:settings"], seed["gymbot:settings"]);
  assert.deepEqual(errors, []);
});
