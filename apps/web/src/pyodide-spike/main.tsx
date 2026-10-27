import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Spike } from "./Spike.tsx";

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <Spike />
    </StrictMode>,
  );
