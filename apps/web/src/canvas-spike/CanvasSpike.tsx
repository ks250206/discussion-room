import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useViewport,
  type NodeTypes,
} from "@xyflow/react";
import { DrawingSurface } from "./DrawingSurface.tsx";
import { MarkdownCard } from "./MarkdownCard.tsx";
import { MetricsPanel } from "./MetricsPanel.tsx";
import { SpikeToolbar } from "./SpikeToolbar.tsx";
import { WorldOverlay } from "./WorldOverlay.tsx";
import { createSyntheticCards } from "./fixtures.ts";
import { idleMetrics, summarizeFrames } from "./frame-metrics.ts";
import type { VisualStroke, Point } from "./coordinates.ts";
import type { CanvasTool, FrameMetrics, SpikeCardNode } from "./types.ts";

const nodeTypes = { markdown: MarkdownCard } satisfies NodeTypes;
const initialViewport = { x: 30, y: 30, zoom: 0.75 };

function LiveMetrics({
  nodeCount,
  strokeCount,
  metrics,
}: {
  nodeCount: number;
  strokeCount: number;
  metrics: FrameMetrics;
}) {
  const viewport = useViewport();
  return (
    <MetricsPanel
      nodeCount={nodeCount}
      strokeCount={strokeCount}
      metrics={metrics}
      viewport={viewport}
    />
  );
}

function SpikeWorkspace() {
  const initialNodes = useMemo(() => createSyntheticCards(12), []);
  const [nodes, setNodes, onNodesChange] = useNodesState<SpikeCardNode>(initialNodes);
  const [tool, setTool] = useState<CanvasTool>("navigate");
  const [strokes, setStrokes] = useState<readonly VisualStroke[]>([]);
  const [drawingRevision, setDrawingRevision] = useState(0);
  const [metrics, setMetrics] = useState<FrameMetrics>(idleMetrics);
  const flow = useReactFlow<SpikeCardNode>();
  const measurementFrame = useRef<number | null>(null);
  const measuring = useRef(false);
  const strokeId = useRef(0);

  const cancelMeasurement = useCallback(() => {
    if (measurementFrame.current !== null) cancelAnimationFrame(measurementFrame.current);
    measurementFrame.current = null;
    if (measuring.current) {
      measuring.current = false;
      setMetrics({ ...idleMetrics, status: "cancelled" });
    }
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) cancelMeasurement();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (measurementFrame.current !== null) cancelAnimationFrame(measurementFrame.current);
    };
  }, [cancelMeasurement]);

  const loadCards = useCallback(
    (count: 12 | 200) => {
      cancelMeasurement();
      setNodes(createSyntheticCards(count));
      setStrokes([]);
      setTool("navigate");
      setMetrics(idleMetrics);
      void flow.setViewport(initialViewport);
    },
    [cancelMeasurement, flow, setNodes],
  );

  const addStroke = useCallback((points: readonly Point[]) => {
    strokeId.current += 1;
    const stroke: VisualStroke = {
      id: `decoration-${strokeId.current}`,
      kind: "decoration",
      points,
    };
    setStrokes((previous) => (previous.length < 100 ? [...previous, stroke] : previous));
  }, []);

  const measure = useCallback(() => {
    cancelMeasurement();
    setNodes(createSyntheticCards(200));
    setStrokes([]);
    setTool("navigate");
    measuring.current = true;
    setMetrics({ ...idleMetrics, status: "measuring" });
    void flow.setViewport({ x: 30, y: 30, zoom: 0.35 });
    // Two RAFs allow the fixture commit before the timed sweep. Startup is excluded.
    measurementFrame.current = requestAnimationFrame(() => {
      measurementFrame.current = requestAnimationFrame(() => {
        let started: number | null = null;
        let previous: number | null = null;
        const intervals: number[] = [];
        const tick = (now: number) => {
          started ??= now;
          if (previous !== null) intervals.push(now - previous);
          previous = now;
          const elapsed = now - started;
          void flow.setViewport({
            x: 30 - Math.min(elapsed / 5000, 1) * 600,
            y: 30 - Math.min(elapsed / 5000, 1) * 900,
            zoom: 0.35,
          });
          if (elapsed < 5000) {
            measurementFrame.current = requestAnimationFrame(tick);
          } else {
            measurementFrame.current = null;
            measuring.current = false;
            setMetrics(summarizeFrames(intervals, elapsed));
          }
        };
        measurementFrame.current = requestAnimationFrame(tick);
      });
    });
  }, [cancelMeasurement, flow, setNodes]);

  return (
    <main className="canvas-spike">
      <header className="spike-heading">
        <h1>
          Canvas coordinate spike <small>Issue #24</small>
        </h1>
        <p>
          Synthetic データのみ。カードとシアンの輪郭線の一致を pan / zoom / resize
          後に確認。ピンクの手描き線はボード上の装飾です。
        </p>
      </header>
      <SpikeToolbar
        tool={tool}
        onToolChange={(next) => {
          cancelMeasurement();
          setTool(next);
        }}
        onLoadCards={loadCards}
        onFit={() => {
          cancelMeasurement();
          void flow.fitView({ padding: 0.1 });
        }}
        onZoomIn={() => {
          cancelMeasurement();
          void flow.zoomIn();
        }}
        onZoomOut={() => {
          cancelMeasurement();
          void flow.zoomOut();
        }}
        onPan={() => {
          cancelMeasurement();
          const view = flow.getViewport();
          void flow.setViewport({ ...view, x: view.x + 120 });
        }}
        onClearDrawing={() => {
          setStrokes([]);
          setDrawingRevision((previous) => previous + 1);
        }}
        onMeasure={measure}
        measuring={metrics.status === "measuring"}
      />
      <div className="spike-workspace">
        <div
          className="spike-board"
          onPointerDownCapture={cancelMeasurement}
          onWheelCapture={cancelMeasurement}
        >
          <ReactFlow<SpikeCardNode>
            nodes={nodes}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            defaultViewport={initialViewport}
            minZoom={0.08}
            maxZoom={2}
            nodesConnectable={false}
            nodesDraggable={tool === "navigate"}
            deleteKeyCode={null}
            onlyRenderVisibleElements={false}
            panOnDrag={tool === "navigate"}
            selectionOnDrag={false}
            onMoveStart={(event) => {
              if (event !== null) cancelMeasurement();
            }}
            onNodeDragStart={cancelMeasurement}
          >
            <Background />
            <WorldOverlay strokes={strokes} first={nodes[0]} />
            {tool === "draw" ? (
              <DrawingSurface key={drawingRevision} strokes={strokes} onStroke={addStroke} />
            ) : null}
          </ReactFlow>
        </div>
        <LiveMetrics nodeCount={nodes.length} strokeCount={strokes.length} metrics={metrics} />
      </div>
      <footer className="spike-notes">
        <p>
          計測: 200 枚 / 全ノードを DOM に保持 / zoom 0.35 / 5 秒で x −600, y −900 px
          の自動パン。入力や非表示で中止。描画開始時間・純粋な render 時間・メモリは測りません。
        </p>
        <p>
          ペン: 最大 100 線、1 線 2,000 点。離脱・キャンセルした線は破棄。Markdown
          は見出し・強調・リスト・コードのみ。再読込で状態を破棄します。
        </p>
      </footer>
    </main>
  );
}

export function CanvasSpike() {
  return (
    <ReactFlowProvider>
      <SpikeWorkspace />
    </ReactFlowProvider>
  );
}
