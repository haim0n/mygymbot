import { useState, useEffect, useSyncExternalStore } from "react";
import { SAVE_RETRY_MS, STORAGE_KEYS } from "./config.js";

// Each user's data lives on the server, one JSON value per key.
export const storageUrl = (key) => `/api/storage/${encodeURIComponent(key)}`;

// The stored value, or undefined if nothing is stored yet. A dropped connection is waited out, never read as
// "nothing stored": the app would then save its empty defaults over your data.
export async function readStored(key) {
  for (;;) {
    try {
      const response = await fetch(storageUrl(key));
      if (response.status === 404) return undefined;
      if (response.ok) return await response.json();
    } catch {
      // Offline or server restarting; try again.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

// Throws { refused: true } when retrying can't help: an expired sign-in (IAP redirects) or a 4xx.
export async function writeStored(key, value) {
  const response = await fetch(storageUrl(key), { method: "PUT", body: JSON.stringify(value), redirect: "manual" });
  if (response.ok) return;
  const refused = response.type === "opaqueredirect" || (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status));
  throw Object.assign(new Error(`Storage error ${response.status || "redirect"}`), { refused });
}

// Values the server hasn't accepted yet, newest per key. One writer per key sends the latest value until it
// lands, so an older value can never arrive after a newer one.
// ponytail: kept in memory; closing the app while offline loses them. Keep them on the phone if that bites.
const unsaved = new Map();
let saveProblem = ""; // "", "retrying", or "refused" (only a reload helps)
const listeners = new Set();
const setSaveProblem = (problem) => {
  if (problem === saveProblem || saveProblem === "refused") return;
  saveProblem = problem;
  listeners.forEach((listener) => listener());
};

function save(key, value) {
  const writing = unsaved.has(key);
  unsaved.set(key, value);
  if (!writing) sendUnsaved(key);
}

async function sendUnsaved(key) {
  for (let wait = SAVE_RETRY_MS.first; ; ) {
    const value = unsaved.get(key);
    try {
      await writeStored(key, value);
      if (unsaved.get(key) === value) unsaved.delete(key);
      if (unsaved.size === 0) setSaveProblem("");
      if (!unsaved.has(key)) return;
      continue; // a newer value came in while this one was on its way
    } catch (err) {
      console.error(`Saving ${key} failed`, err);
      setSaveProblem(err.refused ? "refused" : "retrying");
      if (err.refused) return; // the value stays unsaved, so later changes to this key wait for the reload too
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
    wait = Math.min(wait * 2, SAVE_RETRY_MS.max);
  }
}

// "" while saves land; "retrying" while one waits to be sent again; "refused" when only a reload helps.
export const useSaveProblem = () =>
  useSyncExternalStore((listener) => (listeners.add(listener), () => listeners.delete(listener)), () => saveProblem);

export function usePersistentState(key, initialValue) {
  const [value, setValue] = useState(initialValue);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    readStored(key).then((stored) => {
      if (stored !== undefined) setValue(stored);
      setLoaded(true);
    });
  }, [key]);

  // Debounced save so typing in a form doesn't hit storage on every keystroke.
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => save(key, value), 300);
    return () => clearTimeout(timer);
  }, [key, value, loaded]);

  return [value, setValue, loaded];
}

// Feedback for whoever runs this copy of GymBot; the server keeps every message in one file.
export async function sendFeedback(text, version) {
  const response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, version }) });
  if (!response.ok) throw new Error(`Feedback error ${response.status}`);
}

// Every stored key as one JSON object, so a history can move to another copy of the app.
export async function exportAllData() {
  const entries = await Promise.all(Object.values(STORAGE_KEYS).map(async (key) => [key, await readStored(key)]));
  return JSON.stringify(Object.fromEntries(entries.filter(([, value]) => value !== undefined)));
}
