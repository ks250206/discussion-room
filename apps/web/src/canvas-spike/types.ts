import type { Node } from "@xyflow/react";

export type SpikeCardNode = Node<{ title: string; markdown: string; synthetic: true }, "markdown">;
export type CanvasTool = "navigate" | "draw";
export type FrameMetrics = {
  status: "idle" | "measuring" | "complete" | "cancelled";
  frameCount: number;
  elapsedMs: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  over32Ms: number;
};
export type ToolbarProps = {
  tool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  onLoadCards: (count: 12 | 200) => void;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onPan: () => void;
  onClearDrawing: () => void;
  onMeasure: () => void;
  measuring: boolean;
};
export type MetricsPanelProps = {
  nodeCount: number;
  strokeCount: number;
  viewport: { x: number; y: number; zoom: number };
  metrics: FrameMetrics;
};
