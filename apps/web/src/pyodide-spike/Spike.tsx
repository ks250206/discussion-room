import { useEffect, useRef, useState } from "react";
import { createPyodideController, initialSnapshot } from "./controller.ts";
import { pyodideVersion, runtimeIndexPath } from "./protocol.ts";
import { createModuleWorkerPort } from "./worker-port.ts";
import type { WorkerPort } from "./controller.ts";

function milliseconds(value: number | null) {
  return value === null ? "未計測" : `${value.toFixed(1)} ms`;
}
export function Spike({
  createWorker = createModuleWorkerPort,
}: {
  createWorker?: () => WorkerPort;
}) {
  const controller = useRef<ReturnType<typeof createPyodideController> | null>(null);
  const [state, setState] = useState(initialSnapshot);
  const [heartbeat, setHeartbeat] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    // Each effect setup owns a fresh controller. StrictMode and Fast Refresh
    // preserve component state while replaying effects, so a disposed controller
    // must never be reused by the next setup. Creating it does not start a Worker.
    const active = createPyodideController(createWorker);
    controller.current = active;
    // Reset the displayed snapshot when replacing this external controller.
    // The microtask ignores a setup already retired by StrictMode/effect replay.
    queueMicrotask(() => {
      if (controller.current === active) setState(active.getSnapshot());
    });
    const unsubscribe = active.subscribe(() => setState(active.getSnapshot()));
    const timer = setInterval(() => setHeartbeat((value) => value + 1), 100);
    return () => {
      clearInterval(timer);
      unsubscribe();
      active.dispose();
      if (controller.current === active) controller.current = null;
    };
  }, [createWorker]);
  const busy = state.status === "loading" || state.status === "running";
  return (
    <main className={dark ? "spike dark" : "spike"}>
      <div className="sheet">
        <p className="eyebrow">Issue #25 / #26 · isolated technical spike</p>
        <h1>Python Worker の実行と停止</h1>
        <p>Pyodide {pyodideVersion} / NumPy。固定の合成データだけをブラウザー内で計算します。</p>
        <section aria-labelledby="network-heading">
          <h2 id="network-heading">環境のロードは明示操作</h2>
          <p>
            下のロードボタンを押すと、このページを配信しているローカルサーバーから固定版ランタイム・標準ライブラリー・NumPy
            を読み込みます。外部 CDN には接続しません。研究データやコードを送る API も使用しません。
          </p>
          <p>
            <code>{runtimeIndexPath}</code>
          </p>
          <p>
            配布物が未配置の場合は 404 でエラーになります。リポジトリで{" "}
            <code>pnpm pyodide:fetch</code> を実行してから再ロードしてください。
          </p>
          <button
            disabled={busy || state.status === "ready"}
            onClick={() => controller.current?.initialize()}
          >
            ローカル配信から環境をロード / 再起動
          </button>
        </section>
        <section aria-labelledby="run-heading">
          <h2 id="run-heading">固定デモ</h2>
          <div className="buttons">
            <button
              disabled={state.status !== "ready"}
              onClick={() => controller.current?.run("numpy")}
            >
              NumPy を実行
            </button>
            <button
              disabled={state.status !== "ready"}
              onClick={() => controller.current?.run("infinite")}
            >
              無限ループを開始
            </button>
            <button
              disabled={state.status !== "ready"}
              onClick={() => controller.current?.run("exception")}
            >
              Python 例外を試す
            </button>
            <button className="stop" disabled={!busy} onClick={() => controller.current?.stop()}>
              Stop（Worker 終了）
            </button>
          </div>
          <output aria-live="polite">
            状態: <strong>{state.status}</strong> · 起動時の無効化カウンター {state.generation}
          </output>
          {state.status === "stopped" && (
            <p>
              Worker を終了しました。ロード / 再起動ボタンで新しい Worker を生成し、NumPy
              を再実行できます。Python の変数は引き継ぎません。
            </p>
          )}
          {state.error !== null && (
            <p role="alert" className="error">
              {state.error} 環境を再起動してください。
            </p>
          )}
          <pre aria-label="計算結果">{state.output || "実行結果はまだありません。"}</pre>
          <p>
            NumPy デモ: 1〜10,000 の合計 50,005,000、平均
            5,000.5（期待値）。表示結果は実計算後にだけ入ります。
          </p>
        </section>
        <section aria-labelledby="responsive-heading">
          <h2 id="responsive-heading">UI の応答を確認</h2>
          <p>
            UI heartbeat（100 ms ごとの tick）: <span>{heartbeat}</span>
          </p>
          <div className="buttons">
            <button onClick={() => setClicks((value) => value + 1)}>応答テスト: {clicks}</button>
            <button aria-pressed={dark} onClick={() => setDark((value) => !value)}>
              配色を切り替え
            </button>
          </div>
          <p>
            ロード中・無限ループ中も heartbeat とボタンが動くことを確認し、Stop を押してください。
          </p>
        </section>
        <section aria-labelledby="metrics-heading">
          <h2 id="metrics-heading">このセッションの計測</h2>
          <dl>
            <dt>環境ロード（クリック→NumPy wheel ロード完了、初回 import は含まない）</dt>
            <dd>{milliseconds(state.loadMs)}</dd>
            <dt>実行往復（UI 送信→結果受信）</dt>
            <dd>{milliseconds(state.turnaroundMs)}</dd>
            <dt>Worker 内の Python 実行時間（初回 NumPy import を含む）</dt>
            <dd>{milliseconds(state.computeMs)}</dd>
            <dt>WASM ヒープ確保容量（RSS・実使用量ではありません）</dt>
            <dd>
              {state.heapBytes === null
                ? "取得不可 / 未取得"
                : `${state.heapBytes.toLocaleString()} bytes`}
            </dd>
            <dt>プロセス RSS / 実使用メモリ</dt>
            <dd>取得不可（この spike は対応 API を実装していません）</dd>
            <dt>crossOriginIsolated</dt>
            <dd>{String(globalThis.crossOriginIsolated)}（Stop は SharedArrayBuffer 不要）</dd>
          </dl>
          <p>
            UI の計時は UI 内、Python 実行時間は Worker 内の performance.now() 同士で差を取ります。
            Python 実行時間は runPythonAsync 全体で、初回は NumPy import の時間を含みます。
            合計・平均の演算だけを測った値ではありません。ブラウザーのキャッシュ状態でロード時間は変わります。heartbeat
            は性能保証ではなく目視確認用です。
          </p>
        </section>
      </div>
    </main>
  );
}
