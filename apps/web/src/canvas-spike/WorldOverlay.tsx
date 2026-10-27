import { memo } from "react";
import { ViewportPortal } from "@xyflow/react";
import { cardOutline, strokePath, type VisualStroke } from "./coordinates.ts";
import type { SpikeCardNode } from "./types.ts";

export const WorldOverlay = memo(function WorldOverlay({
  strokes,
  first,
}: {
  strokes: readonly VisualStroke[];
  first: SpikeCardNode | undefined;
}) {
  const outline = first
    ? cardOutline(
        first.position,
        first.measured?.width ?? first.width ?? 260,
        first.measured?.height ?? first.height ?? 180,
      )
    : [];
  return (
    <ViewportPortal>
      <svg className="spike-world-svg" aria-hidden="true">
        {strokes.map((stroke) => (
          <path
            key={stroke.id}
            d={strokePath(stroke.points)}
            fill="none"
            stroke="#be185d"
            strokeWidth={3}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path
          data-testid="alignment-guide"
          d={strokePath(outline)}
          fill="none"
          stroke="#0891b2"
          strokeWidth={2}
          strokeDasharray="7 4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </ViewportPortal>
  );
});
