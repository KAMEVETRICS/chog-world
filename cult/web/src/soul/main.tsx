import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SoulPage } from "./SoulPage";
import "../styles.css";
import "../theme/chog.css";
import "./soul-theme.css";

createRoot(document.getElementById("root")!).render(<StrictMode><SoulPage /></StrictMode>);
