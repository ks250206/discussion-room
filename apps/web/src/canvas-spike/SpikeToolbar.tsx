import type { ToolbarProps } from "./types.ts";
// oxlint-disable-next-line import/no-unassigned-import -- Panel stylesheet is an intentional side effect.
import "./panels.css";

export const SpikeToolbar = (props: ToolbarProps) => (
  <div className="spike-toolbar">
    <p className="spike-toolbar-synthetic">
      <span lang="en">Synthetic. </span>
      <span lang="ja">合成データです。実測値ではありません。</span>{" "}
      <span lang="en">Fabricated content only. Not measured data.</span>
    </p>
    <fieldset className="spike-toolbar-group">
      <legend>
        <span lang="ja">ツール</span> <span lang="en">Tool</span>
      </legend>
      <button
        type="button"
        aria-pressed={props.tool === "navigate"}
        onClick={() => {
          props.onToolChange("navigate");
        }}
      >
        <span lang="ja">選択 / パン</span>
        <span className="spike-label-en" lang="en">
          Select/Pan
        </span>
      </button>
      <button
        type="button"
        aria-pressed={props.tool === "draw"}
        onClick={() => {
          props.onToolChange("draw");
        }}
      >
        <span lang="ja">ペン</span>
        <span className="spike-label-en" lang="en">
          Pen
        </span>
      </button>
    </fieldset>
    <fieldset className="spike-toolbar-group">
      <legend>
        <span lang="ja">合成カード</span> <span lang="en">Synthetic cards</span>
      </legend>
      <button
        type="button"
        onClick={() => {
          props.onLoadCards(12);
        }}
      >
        <span lang="ja">合成カード 12枚</span>
        <span className="spike-label-en" lang="en">
          12 cards
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          props.onLoadCards(200);
        }}
      >
        <span lang="ja">合成カード 200枚</span>
        <span className="spike-label-en" lang="en">
          200 cards
        </span>
      </button>
    </fieldset>
    <fieldset className="spike-toolbar-group">
      <legend>
        <span lang="ja">表示</span> <span lang="en">View</span>
      </legend>
      <button type="button" onClick={props.onFit}>
        <span lang="ja">全体表示</span>
        <span className="spike-label-en" lang="en">
          Fit
        </span>
      </button>
      <button type="button" onClick={props.onZoomIn}>
        <span lang="ja">ズームイン</span>
        <span className="spike-label-en" lang="en">
          Zoom in
        </span>
      </button>
      <button type="button" onClick={props.onZoomOut}>
        <span lang="ja">ズームアウト</span>
        <span className="spike-label-en" lang="en">
          Zoom out
        </span>
      </button>
      <button type="button" onClick={props.onPan}>
        <span lang="ja">パン +120px</span>
        <span className="spike-label-en" lang="en">
          Pan +120px
        </span>
      </button>
    </fieldset>
    <fieldset className="spike-toolbar-group">
      <legend>
        <span lang="ja">描画</span> <span lang="en">Drawing</span>
      </legend>
      <button type="button" onClick={props.onClearDrawing}>
        <span lang="ja">描画を消す</span>
        <span className="spike-label-en" lang="en">
          Clear drawing
        </span>
      </button>
    </fieldset>
    <fieldset className="spike-toolbar-group">
      <legend>
        <span lang="ja">計測</span> <span lang="en">Measure</span>
      </legend>
      <button type="button" onClick={props.onMeasure} disabled={props.measuring}>
        <span lang="ja">5秒計測</span>
        <span className="spike-label-en" lang="en">
          Measure 5 sec
        </span>
      </button>
    </fieldset>
    <section className="spike-toolbar-help" aria-label="操作説明 Instructions">
      <p>
        <span lang="ja">
          選択 /
          パンでは、タイトルをドラッグしてカードを移動できます。選択したカードは角で大きさを変えられます。
        </span>{" "}
        <span lang="en">
          With Select/Pan, drag a card by its title. Resize the selected card from a corner.
        </span>
      </p>
      <p>
        <span lang="ja">ペンは装飾の線を描きます。カードの移動やパンはしません。</span>{" "}
        <span lang="en">Pen draws a decoration stroke. It does not move cards or pan.</span>
      </p>
    </section>
  </div>
);
