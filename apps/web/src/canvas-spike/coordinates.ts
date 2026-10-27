// Adapter boundary: world points are independent of React Flow and DOM coordinates.
export type Point = { x: number; y: number };
export type ViewTransform = Point & { zoom: number };
export type ScreenOrigin = { left: number; top: number };
export type VisualStroke = { id: string; kind: "decoration"; points: readonly Point[] };

export const worldToScreen = (
  point: Point,
  viewport: ViewTransform,
  origin: ScreenOrigin,
): Point => ({
  x: origin.left + viewport.x + point.x * viewport.zoom,
  y: origin.top + viewport.y + point.y * viewport.zoom,
});

export const screenToWorld = (
  point: Point,
  viewport: ViewTransform,
  origin: ScreenOrigin,
): Point | null => {
  if (
    ![point.x, point.y, viewport.x, viewport.y, viewport.zoom, origin.left, origin.top].every(
      Number.isFinite,
    ) ||
    viewport.zoom <= 0
  )
    return null;
  return {
    x: (point.x - origin.left - viewport.x) / viewport.zoom,
    y: (point.y - origin.top - viewport.y) / viewport.zoom,
  };
};

export const strokePath = (points: readonly Point[]): string =>
  points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(3)},${point.y.toFixed(3)}`)
    .join(" ");

export const cardOutline = (position: Point, width: number, height: number): readonly Point[] => [
  position,
  { x: position.x + width, y: position.y },
  { x: position.x + width, y: position.y + height },
  { x: position.x, y: position.y + height },
  position,
];
