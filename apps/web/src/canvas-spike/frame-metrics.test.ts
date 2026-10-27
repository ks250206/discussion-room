import { describe, expect, it } from "vite-plus/test";
import { summarizeFrames } from "./frame-metrics.ts";

describe("RAF measurement summary", () => {
  it("reports nearest-rank quantiles, measured elapsed time and slow intervals", () => {
    expect(summarizeFrames([16, 20, 40, 10, 50], 136)).toEqual({
      status: "complete",
      frameCount: 5,
      elapsedMs: 136,
      medianMs: 20,
      p95Ms: 50,
      over32Ms: 2,
    });
  });
  it("keeps missing timing absent and excludes invalid intervals", () => {
    expect(summarizeFrames([], 0).medianMs).toBeNull();
    expect(summarizeFrames([], 0).p95Ms).toBeNull();
    expect(summarizeFrames([NaN, Infinity, -1, 17], 17).frameCount).toBe(1);
  });
});
