import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App";
import { WorkspaceGate } from "./workspace";

createRoot(document.getElementById("root")!).render(
  <WorkspaceGate><App /></WorkspaceGate>,
);
