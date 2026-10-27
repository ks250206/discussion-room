import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useReactFlow, ViewportPortal } from "@xyflow/react";
import { screenToWorld, strokePath, type Point, type VisualStroke } from "./coordinates.ts";

const maxPoints = 2000;
const maxStrokes = 100;

export function DrawingSurface({
  strokes,
  onStroke,
}: {
  strokes: readonly VisualStroke[];
  onStroke: (points: readonly Point[]) => void;
}) {
  const flow = useReactFlow();
  const [preview, setPreview] = useState<readonly Point[]>([]);
  const draft = useRef<{ pointerId: number; points: Point[] } | null>(null);
  const scheduled = useRef<number | null>(null);
  const pending = useRef<Point | null>(null);

  useEffect(
    () => () => {
      if (scheduled.current !== null) cancelAnimationFrame(scheduled.current);
    },
    [],
  );

  const toWorld = (event: PointerEvent<HTMLElement>): Point | null =>
    screenToWorld(
      { x: event.clientX, y: event.clientY },
      flow.getViewport(),
      event.currentTarget.getBoundingClientRect(),
    );

  const appendPending = () => {
    const active = draft.current;
    const next = pending.current;
    if (active && next && active.points.length < maxPoints) {
      active.points.push(next);
      setPreview([...active.points]);
    }
    pending.current = null;
  };

  const start = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || draft.current || strokes.length >= maxStrokes) return;
    const point = toWorld(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    draft.current = { pointerId: event.pointerId, points: [point] };
    setPreview([point]);
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    if (draft.current?.pointerId !== event.pointerId) return;
    pending.current = toWorld(event);
    if (scheduled.current !== null) return;
    scheduled.current = requestAnimationFrame(() => {
      scheduled.current = null;
      appendPending();
    });
  };

  const finish = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    if (draft.current?.pointerId !== event.pointerId) return;
    if (scheduled.current !== null) cancelAnimationFrame(scheduled.current);
    scheduled.current = null;
    if (!cancelled) {
      pending.current = toWorld(event);
      appendPending();
      const points = draft.current.points;
      if (points.length >= 2) onStroke([...points]);
    }
    draft.current = null;
    pending.current = null;
    setPreview([]);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <>
      <section
        className="spike-drawing-surface nopan nodrag"
        aria-label="手描き入力面。ペンで装飾線を描画"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={(event) => finish(event, false)}
        onPointerCancel={(event) => finish(event, true)}
        onLostPointerCapture={(event) => finish(event, true)}
      />
      <ViewportPortal>
        <svg className="spike-world-svg" aria-hidden="true">
          <path
            d={strokePath(preview)}
            fill="none"
            stroke="#be185d"
            strokeWidth={3}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </ViewportPortal>
    </>
  );
}
