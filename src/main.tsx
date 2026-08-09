import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App";
import { WorkspaceGate } from "./workspace";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkspaceGate><App /></WorkspaceGate>
  </StrictMode>,
);
