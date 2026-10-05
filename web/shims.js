// Stand-ins for what claude.ai gives an artifact, backed by the Python server. Nothing here ships in src/gymbot.jsx.
//   window.storage  → /api/storage on the server (a JSON file), same keys and the same promise-based API.
//   Claude API      → POST /api/messages on the server, which answers with Gemini in the same reply shape.

const storageUrl = (key) => `/api/storage/${encodeURIComponent(key)}`;

// Reads wait out a dropped connection instead of failing: the app treats a failed read as "nothing stored yet"
// and would then save its empty defaults over your data.
async function read(url) {
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return response;
    } catch {
      // Offline or server restarting; try again.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function write(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Storage error ${response.status}`);
}

window.storage = {
  async get(key) {
    const response = await read(storageUrl(key));
    if (response.status === 404) throw new Error(`No value stored for ${key}`); // the real API throws for missing keys too
    return { key, value: await response.text(), shared: false };
  },
  async set(key, value) {
    await write(storageUrl(key), { method: "PUT", body: value });
    return { key, value, shared: false };
  },
  async delete(key) {
    await write(storageUrl(key), { method: "DELETE" });
    return { key, deleted: true, shared: false };
  },
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const browserFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  return browserFetch(url === ANTHROPIC_URL ? "/api/messages" : input, init);
};
