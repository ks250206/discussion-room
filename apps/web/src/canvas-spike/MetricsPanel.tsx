import type { MetricsPanelProps } from "./types.ts";

const frameStatusLabel = (
  status: MetricsPanelProps["metrics"]["status"],
): { readonly ja: string; readonly en: string } => {
  switch (status) {
    case "idle":
      return { ja: "待機", en: "idle" };
    case "measuring":
      return { ja: "計測中", en: "measuring" };
    case "complete":
      return { ja: "完了", en: "complete" };
    case "cancelled":
      return { ja: "中断", en: "cancelled" };
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
};

const formatMilliseconds = (value: number | null): string =>
  value === null ? "未計測" : `${value.toFixed(2)} ms`;

export const MetricsPanel = (props: MetricsPanelProps) => {
  const status = frameStatusLabel(props.metrics.status);
  return (
    <section className="spike-metrics" aria-label="計数 Metrics">
      <h2>
        <span lang="ja">計数</span> <span lang="en">Metrics</span>
      </h2>
      <dl>
        <dt>
          <span lang="ja">ノード数</span>
          <span className="spike-label-en" lang="en">
            Nodes
          </span>
        </dt>
        <dd>{props.nodeCount}</dd>
        <dt>
          <span lang="ja">ストローク数</span>
          <span className="spike-label-en" lang="en">
            Strokes
          </span>
        </dt>
        <dd>{props.strokeCount}</dd>
        <dt>
          <span lang="ja">ビューポート x</span>
          <span className="spike-label-en" lang="en">
            Viewport x
          </span>
        </dt>
        <dd>{props.viewport.x.toFixed(2)}</dd>
        <dt>
          <span lang="ja">ビューポート y</span>
          <span className="spike-label-en" lang="en">
            Viewport y
          </span>
        </dt>
        <dd>{props.viewport.y.toFixed(2)}</dd>
        <dt>
          <span lang="ja">ズーム</span>
          <span className="spike-label-en" lang="en">
            Zoom
          </span>
        </dt>
        <dd>{props.viewport.zoom.toFixed(3)}</dd>
      </dl>
      <section aria-label="RAF 間隔 RAF intervals">
        <h3>
          <span lang="ja">RAF 間隔</span> <span lang="en">RAF intervals</span>
        </h3>
        <p className="spike-metrics-note">
          <span lang="ja">
            時間は渡された requestAnimationFrame
            の間隔です。純粋な描画時間ではなく、メモリは測っていません。null は「未計測」、0
            はゼロです。
          </span>{" "}
          <span lang="en">
            Times are supplied requestAnimationFrame intervals: frame cadence, not pure render time.
            Memory is not measured. Null is shown as 未計測 (not measured); 0 is zero.
          </span>
        </p>
        <dl>
          <dt>
            <span lang="ja">状態</span>
            <span className="spike-label-en" lang="en">
              Status
            </span>
          </dt>
          <dd>
            <span lang="ja">{status.ja}</span> <span lang="en">({status.en})</span>
          </dd>
          <dt>
            <span lang="ja">RAF 間隔サンプル数</span>
            <span className="spike-label-en" lang="en">
              Interval samples
            </span>
          </dt>
          <dd>{props.metrics.frameCount}</dd>
          <dt>
            <span lang="ja">経過</span>
            <span className="spike-label-en" lang="en">
              Elapsed
            </span>
          </dt>
          <dd>{formatMilliseconds(props.metrics.elapsedMs)}</dd>
          <dt>
            <span lang="ja">中央値</span>
            <span className="spike-label-en" lang="en">
              Median
            </span>
          </dt>
          <dd>{formatMilliseconds(props.metrics.medianMs)}</dd>
          <dt>
            <span lang="ja">p95</span>
            <span className="spike-label-en" lang="en">
              p95
            </span>
          </dt>
          <dd>{formatMilliseconds(props.metrics.p95Ms)}</dd>
          <dt>
            <span lang="ja">32ms超の件数</span>
            <span className="spike-label-en" lang="en">
              Frames over 32 ms
            </span>
          </dt>
          <dd>{props.metrics.over32Ms}</dd>
        </dl>
      </section>
    </section>
  );
};
