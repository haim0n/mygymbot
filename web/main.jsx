import { createRoot } from "react-dom/client";
import GymBot from "../src/App.jsx";
import { APP_VERSION } from "../src/config.js";

// Errors on the phone go to the server log, each message once per page load, or we would never hear of them.
const reported = new Set();
function reportError(error) {
  const message = error instanceof Error ? `${error}\n${error.stack}` : String(error); // Safari's stack lacks the message
  if (reported.has(message)) return;
  reported.add(message);
  const body = JSON.stringify({ message, version: APP_VERSION });
  fetch("/api/errors", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}
window.addEventListener("error", (event) => reportError(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => reportError(event.reason));

createRoot(document.getElementById("root")).render(<GymBot />);
