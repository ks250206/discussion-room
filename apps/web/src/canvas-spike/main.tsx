import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CanvasSpike } from "./CanvasSpike.tsx";
// oxlint-disable-next-line import/no-unassigned-import -- React Flow requires its base stylesheet.
import "@xyflow/react/dist/style.css";
// oxlint-disable-next-line import/no-unassigned-import -- Isolated entry stylesheet has intentional side effects.
import "./spike.css";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <CanvasSpike />
    </StrictMode>,
  );
