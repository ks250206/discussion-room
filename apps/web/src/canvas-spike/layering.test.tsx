// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vite-plus/test";
import flowCss from "@xyflow/react/dist/style.css?raw";
import spikeCss from "./spike.css?raw";
import { CanvasSpike } from "./CanvasSpike.tsx";

const styles = (): HTMLStyleElement => {
  const style = document.createElement("style");
  style.textContent = flowCss + spikeCss;
  document.head.append(style);
  return style;
};

const element = (selector: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`Missing test element: ${selector}`);
  return found;
};

afterEach(() => {
  cleanup();
  for (const style of document.head.querySelectorAll("style")) style.remove();
});

test("world decorations paint above an elevated selected card without intercepting navigation", () => {
  styles();
  render(<CanvasSpike />);
  const portal = element(".react-flow__viewport-portal");
  const card = element(".react-flow__node.selected");
  expect(Number(getComputedStyle(card).zIndex)).toBeGreaterThan(0);
  expect(Number(getComputedStyle(portal).zIndex)).toBeGreaterThan(
    Number(getComputedStyle(card).zIndex),
  );
  expect(getComputedStyle(portal).pointerEvents).toBe("none");
  expect(getComputedStyle(element(".spike-world-svg")).pointerEvents).toBe("none");
  expect(document.querySelector(".spike-drawing-surface")).toBeNull();
});

test("pen capture surface sits above the renderer and is removed when navigation resumes", async () => {
  styles();
  const user = userEvent.setup();
  render(<CanvasSpike />);
  await user.click(screen.getByRole("button", { name: /ペン/ }));
  const capture = element(".spike-drawing-surface");
  const renderer = element(".react-flow__renderer");
  expect(Number(getComputedStyle(capture).zIndex)).toBeGreaterThan(
    Number(getComputedStyle(renderer).zIndex),
  );
  expect(getComputedStyle(capture).pointerEvents).not.toBe("none");
  await user.click(screen.getByRole("button", { name: /選択 \/ パン/ }));
  expect(document.querySelector(".spike-drawing-surface")).toBeNull();
});
