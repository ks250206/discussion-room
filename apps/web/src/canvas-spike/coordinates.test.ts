import { describe, expect, it } from "vite-plus/test";
import { cardOutline, screenToWorld, strokePath, worldToScreen } from "./coordinates.ts";

describe("canvas coordinate adapter", () => {
  it("round-trips board coordinates after pan/zoom and page/board offsets", () => {
    const point = { x: 320.125, y: -17.5 };
    const origin = { left: 83, top: 207 };
    for (const zoom of [0.08, 0.35, 1, 2]) {
      for (const offset of [-1200, 0, 812.5]) {
        const viewport = { x: offset, y: -offset / 2, zoom };
        const result = screenToWorld(worldToScreen(point, viewport, origin), viewport, origin);
        expect(result?.x).toBeCloseTo(point.x, 10);
        expect(result?.y).toBeCloseTo(point.y, 10);
      }
    }
  });

  it("keeps captured world points stable when the viewport changes", () => {
    const original = screenToWorld(
      { x: 450, y: 350 },
      { x: 20, y: 30, zoom: 0.5 },
      { left: 30, top: 120 },
    );
    expect(original).toEqual({ x: 800, y: 400 });
    expect(
      worldToScreen({ x: 800, y: 400 }, { x: -200, y: 90, zoom: 2 }, { left: 30, top: 120 }),
    ).toEqual({ x: 1430, y: 1010 });
  });

  it("rejects non-finite and singular transforms without throwing", () => {
    for (const zoom of [0, -1, Number.NaN, Infinity]) {
      expect(screenToWorld({ x: 1, y: 2 }, { x: 0, y: 0, zoom }, { left: 0, top: 0 })).toBeNull();
    }
    expect(
      screenToWorld({ x: Infinity, y: 2 }, { x: 0, y: 0, zoom: 1 }, { left: 0, top: 0 }),
    ).toBeNull();
  });

  it("builds a matching outline after moving and resizing a card", () => {
    const outline = cardOutline({ x: -42, y: 19 }, 381, 246);
    expect(outline).toEqual([
      { x: -42, y: 19 },
      { x: 339, y: 19 },
      { x: 339, y: 265 },
      { x: -42, y: 265 },
      { x: -42, y: 19 },
    ]);
    expect(strokePath(outline)).toBe(
      "M-42.000,19.000 L339.000,19.000 L339.000,265.000 L-42.000,265.000 L-42.000,19.000",
    );
    expect(strokePath([])).toBe("");
  });
});
