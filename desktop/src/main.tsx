import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { MirrorWindow } from "./components/MirrorWindow";

let isMirrorWindow =
  new URLSearchParams(window.location.search).get("window") === "mirror";
try {
  if (getCurrentWindow().label === "mirror") {
    isMirrorWindow = true;
  }
} catch {
  // Repli si exécuté hors contexte Tauri
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isMirrorWindow ? <MirrorWindow /> : <App />}
  </React.StrictMode>,
);
