// Local stand-ins for what claude.ai gives an artifact. Dev only; nothing here ships in src/gymbot.jsx.
//   window.storage  → localStorage, same keys and the same promise-based API.
//   Claude API      → POST /api/messages on the dev server, which adds your API key server-side.

window.storage = {
  async get(key) {
    const value = localStorage.getItem(key);
    if (value === null) throw new Error(`No value stored for ${key}`); // the real API throws for missing keys too
    return { key, value, shared: false };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value, shared: false };
  },
  async delete(key) {
    localStorage.removeItem(key);
    return { key, deleted: true, shared: false };
  },
  async list(prefix = "") {
    return { keys: Object.keys(localStorage).filter((k) => k.startsWith(prefix)), prefix, shared: false };
  },
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const browserFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  return browserFetch(url === ANTHROPIC_URL ? "/api/messages" : input, init);
};
