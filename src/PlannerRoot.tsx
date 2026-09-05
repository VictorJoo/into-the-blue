"use client";

import App from "./App";
import { WorkspaceGate } from "./workspace";

export default function PlannerRoot() {
  return (
    <WorkspaceGate>
      <App />
    </WorkspaceGate>
  );
}
