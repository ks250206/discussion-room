import type { FrameMetrics } from "./types.ts";

export const idleMetrics: FrameMetrics = {
  status: "idle",
  frameCount: 0,
  elapsedMs: null,
  medianMs: null,
  p95Ms: null,
  over32Ms: 0,
};

export const summarizeFrames = (intervals: readonly number[], elapsedMs: number): FrameMetrics => {
  const sorted = intervals
    .filter((value) => Number.isFinite(value) && value >= 0)
    .toSorted((a, b) => a - b);
  const percentile = (fraction: number): number | null =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
  return {
    status: "complete",
    frameCount: sorted.length,
    elapsedMs,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    over32Ms: sorted.filter((value) => value > 32).length,
  };
};
