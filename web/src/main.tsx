import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";

// Light and dark follow the device.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const apply = () => document.documentElement.classList.toggle("dark", dark.matches);
apply();
dark.addEventListener("change", apply);

createRoot(document.getElementById("root")!).render(<App />);
