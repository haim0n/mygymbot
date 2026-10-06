import { useState, useEffect } from "react";
import { STORAGE_KEYS } from "./config.js";

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

export async function writeStored(key, value) {
  const response = await fetch(storageUrl(key), { method: "PUT", body: JSON.stringify(value) });
  if (!response.ok) throw new Error(`Storage error ${response.status}`);
}

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
    const timer = setTimeout(() => writeStored(key, value).catch((err) => console.error(`Saving ${key} failed`, err)), 300);
    return () => clearTimeout(timer);
  }, [key, value, loaded]);

  return [value, setValue, loaded];
}

// Every stored key as one JSON object, so a history can move to another copy of the app.
export async function exportAllData() {
  const entries = await Promise.all(Object.values(STORAGE_KEYS).map(async (key) => [key, await readStored(key)]));
  return JSON.stringify(Object.fromEntries(entries.filter(([, value]) => value !== undefined)));
}
