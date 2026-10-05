import { createRoot } from "react-dom/client";
import "./shims.js";
import GymBot from "../src/gymbot.jsx";

createRoot(document.getElementById("root")).render(<GymBot />);
