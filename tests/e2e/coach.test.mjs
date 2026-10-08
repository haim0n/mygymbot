import { test } from "node:test";
import assert from "node:assert/strict";
import { isCoachChat, openApp, section, stored, settle } from "./helpers.mjs";
import { userWorkout, yesterdayWorkout, settings } from "../fixtures.mjs";

test("check-in: asks about the latest workout, sends, saves, then goes away", async (t) => {
  const { page, errors, aiRequests } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout, yesterdayWorkout] },
    ai: (body) => (body.system.includes("checking in after a workout") ? "Good session. Rest the knee." : "OK"),
  });
  await page.getByRole("button", { name: /^Log/ }).tap();
  const card = section(page, "How did it go?");
  assert.ok(await card.getByRole("button", { name: "Send to coach" }).isDisabled());

  await card.getByRole("radio", { name: "Hard" }).tap();
  await card.getByRole("radio", { name: "A little" }).tap();
  await card.getByPlaceholder(/Slept badly/).fill("left knee a bit sore");
  await card.getByRole("button", { name: "Send to coach" }).tap();
  await page.getByText("Rest the knee.").waitFor();
  await settle(page);

  const sent = aiRequests.find((b) => b.system.includes("checking in after a workout")).messages[0].content;
  assert.ok(sent.startsWith("CHECK-IN for the 2026-10-02 workout: effort Hard; pain A little; note: left knee a bit sore"));
  const saved = (await stored(page, "gymbot:workouts")).find((w) => w.id === "oct2").checkIn;
  assert.deepEqual({ ...saved, reply: undefined }, { effort: "Hard", pain: "A little", note: "left knee a bit sore", reply: undefined });
  assert.equal(await card.count(), 0);
  assert.deepEqual(errors, []);
});

test("coach: video tags become library links; anything else is dropped", async (t) => {
  const { page, errors } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout] },
    ai: (body) => (body.system.startsWith("You are GymBot, a direct") ? "Neutral grip.\n[video: Hammer Curl]\n[video: Zercher Squat]\nhttps://example.com/fake" : "OK"),
  });
  await page.getByPlaceholder("Message your coach").fill("how do I do hammer curls?");
  await page.getByRole("button", { name: "Send" }).tap();
  await page.getByText("Neutral grip.").waitFor();
  const reply = page.locator("div.rounded-bl-md").last();
  assert.deepEqual(await reply.getByRole("link").evaluateAll((links) => links.map((a) => a.href)), ["https://www.youtube.com/watch?v=zC3nLlEvin4"]);
  assert.ok(!(await reply.innerText()).includes("Zercher"));
  assert.deepEqual(errors, []);
});

test("coach memory: what the athlete says is remembered, shown in Goals, editable, and sent with later chats", async (t) => {
  const { page, errors, aiRequests } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout] },
    ai: (body) => (!isCoachChat(body) ? "OK" : body.messages.at(-1).content.includes("like") ? "Dumbbells it is.\n[remember: Prefers dumbbells over barbells]" : "Upper body today."),
  });
  await page.getByPlaceholder("Message your coach").fill("I like dumbbells more than barbells");
  await page.getByRole("button", { name: "Send" }).tap();
  await page.getByText("Noted: Prefers dumbbells over barbells").waitFor();
  await settle(page);
  assert.deepEqual((await stored(page, "gymbot:settings")).coachMemory.map((f) => f.text), ["Prefers dumbbells over barbells"]);

  await page.getByRole("button", { name: "Goals", exact: true }).tap();
  const panel = section(page, "What your coach knows");
  await panel.getByLabel("Fact 1", { exact: true }).fill("Prefers dumbbells");
  await page.getByRole("button", { name: "Coach", exact: true }).tap();
  await page.getByPlaceholder("Message your coach").fill("what should I do today?");
  await page.getByRole("button", { name: "Send" }).tap();
  await settle(page);
  assert.match(aiRequests.filter(isCoachChat).at(-1).system, /WHAT YOU KNOW ABOUT THE ATHLETE[^\n]*\n- Prefers dumbbells \(\d{4}-\d\d-\d\d\)/);

  await page.getByRole("button", { name: "Goals", exact: true }).tap();
  await panel.getByRole("button", { name: "Delete fact 1" }).tap();
  await panel.getByRole("button", { name: "Tap to delete" }).tap();
  await panel.getByText("Tell your coach about preferences").waitFor();
  await settle(page);
  assert.deepEqual((await stored(page, "gymbot:settings")).coachMemory, []);
  assert.deepEqual(errors, []);
});

test("onboarding: a new athlete's coach asks first, then the profile and plans it suggests are saved", async (t) => {
  const { page, errors, aiRequests } = await openApp(t, {
    ai: (body) =>
      isCoachChat(body)
        ? "Here's your start.\n[profile: experience: Beginner; daysPerWeek: 3; focus: General fitness; music: hip hop]\n[plan: A: Goblet Squat, Push-up]\n[plan: B: Romanian Deadlift, Lat Pulldown]"
        : "OK",
  });
  await page.getByText("A few quick questions first").waitFor();
  assert.equal(await page.getByRole("button", { name: "Clear chat" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Analyze my last 4 weeks" }).count(), 0); // no quick prompts about data they don't have
  await page.getByPlaceholder("Message your coach").fill("Just feel fitter");
  await page.getByRole("button", { name: "Send" }).tap();
  await page.getByText("Here's your start.").waitFor();

  const sent = aiRequests.find(isCoachChat);
  assert.ok(sent.system.includes("NEW ATHLETE"));
  assert.deepEqual(sent.messages, [{ role: "user", content: "Just feel fitter" }]); // the opening question is in the prompt, not a turn
  await page.getByRole("button", { name: "Save to profile" }).tap();
  await page.getByRole("button", { name: "Save plan A" }).tap();
  await page.getByRole("button", { name: "Save plan B" }).tap();
  await page.getByText("Your first workout is ready: A.").waitFor();
  await page.getByText("A few quick questions first").waitFor(); // still in the chat
  await settle(page);

  const saved = await stored(page, "gymbot:settings");
  assert.deepEqual([saved.profile.experience, saved.profile.daysPerWeek, saved.profile.focus, saved.profile.music], ["Beginner", 3, "General fitness", "hip hop"]);
  assert.deepEqual(saved.routines.map((r) => r.name), ["A", "B"]);
  assert.equal(aiRequests.filter((b) => b.system.includes("motivation note")).length, 0); // no daily note before there's anything to say
  assert.deepEqual(errors, []);
});

test("onboarding: the coach's first message offers to import history from another app", async (t) => {
  const { page, errors } = await openApp(t);
  await page.getByText("Already logging workouts in another app").waitFor();
  await page.getByRole("button", { name: "Import history" }).tap();
  await section(page, "Import history").getByText("Export a CSV from Strong, Hevy").waitFor(); // Log, with the import open
  assert.equal(await page.getByRole("button", { name: "Close import" }).count(), 1);
  assert.deepEqual(errors, []);
});

test("today card: planned workout first, and the daily note becomes a pep talk", async (t) => {
  const { page, errors, aiRequests } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout], "gymbot:settings": settings({ trainingDays: [6], trainingTime: "20:00" }) },
    ai: (body) => (body.system.includes("motivation note") ? "Big one tonight." : "OK"),
  });
  await page.getByText("Big one tonight.").waitFor();
  const facts = await section(page, "Today").locator("li").allInnerTexts();
  assert.match(facts[0], /^Workout planned today at 20:00/);
  const note = aiRequests.find((b) => b.system.includes("motivation note"));
  assert.ok(note.system.includes("pep talk"));
  assert.ok(note.messages[0].content.includes("Workout planned today at 20:00"));
  assert.deepEqual(errors, []);
});

test("injuries: the profile note is read into muscles, and Autopilot holds the lifts that work them", async (t) => {
  const { page, errors, aiRequests } = await openApp(t, {
    seed: { "gymbot:workouts": [userWorkout] },
    ai: (body) => (body.system.startsWith("Below is an athlete's note") ? '{"muscles":["shoulders","nonsense"]}' : "OK"),
  });
  await page.getByRole("button", { name: "Goals", exact: true }).tap();
  await page.getByPlaceholder(/Left shoulder gets cranky/).fill("Left shoulder sore since last week");
  await page.getByText("Autopilot keeps the weight on lifts that work your shoulders.").waitFor();
  assert.equal(aiRequests.filter((b) => b.system.startsWith("Below is an athlete's note")).length, 1); // once, after typing stopped
  await settle(page);
  assert.deepEqual((await stored(page, "gymbot:settings")).injuryAreas, { notes: "Left shoulder sore since last week", muscles: ["shoulders"] });

  await page.getByRole("button", { name: /^Log/ }).tap();
  const bench = page.locator("li", { hasText: "Bench Press (Dumbbell)" }).first();
  await bench.getByText("Hold for pain").waitFor();
  assert.match(await bench.innerText(), /Easy on your shoulders/);
  assert.deepEqual(errors, []);
});

test("form check: photos go to the AI as base64 JPEG images next to the request", async (t) => {
  const { page, errors, aiRequests } = await openApp(t, {
    ai: (body) => (body.system.startsWith("You are an expert strength coach") ? "**Verdict**: solid lockout." : "OK"),
  });
  await page.getByRole("button", { name: "Form", exact: true }).tap();
  await page.getByPlaceholder("Back Squat").fill("Deadlift");
  await page.getByLabel("Upload a video or photos").setInputFiles({ name: "lockout.png", mimeType: "image/png", buffer: Buffer.from(PNG_1PX, "base64") });
  await page.getByAltText("Frame 1").waitFor();
  await page.getByRole("button", { name: "Check my form" }).tap();
  await page.getByText("solid lockout.").first().waitFor(); // the feedback, and the same text under Past checks
  const [message] = aiRequests.find((b) => b.system.startsWith("You are an expert strength coach")).messages;
  assert.match(message.content, /^Exercise: Deadlift\./);
  assert.equal(message.images.length, 1);
  assert.ok(Buffer.from(message.images[0], "base64").subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))); // re-encoded as JPEG
  assert.deepEqual(errors, []);
});

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
