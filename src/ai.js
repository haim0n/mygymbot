// Asks the server's AI. `messages`: [{ role: "user" | "assistant", content, images?: [base64 JPEG] }].
export async function askAI(system, messages) {
  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages }),
  });
  if (!response.ok) throw new Error(`The coach didn't respond (error ${response.status}). Try again.`);
  return (await response.json()).text.trim();
}

export async function askAIForJson(system, content, images = []) {
  const raw = await askAI(system, [{ role: "user", content, images }]);
  return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); // ignore any text or code fences around the JSON
}

// Last `count` messages, trimmed so the list starts with a user turn (API requirement).
export function recentTurns(messages, count) {
  const turns = messages.slice(-count);
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}
