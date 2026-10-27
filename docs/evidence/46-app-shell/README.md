# #46 実ブラウザ検証

2026-10-27、`feat/46-app-shell` の最新 source から `vp build` / `vp run -r build` を実行し、`pnpm start --port 18846` で配信した成果物を Chrome で確認した。対象アセットは `index-B47xSSEY.js` / `index-BTEoEnD-.css`。本番の静的配信と SPA fallback を使用し、開発サーバーの別ブランチを代用していない。

検証専用 HTML を git 管理外の `apps/web/dist/` に置き、同一 origin の iframe にビルド済み画面を表示した。iframe の幅・高さと `color-scheme` を明示しており、外側の灰色部分と測定表示は製品 UI ではない。OS やブラウザの設定を変更していない。埋込文書の配色は [CSS Color Adjustment](https://drafts.csswg.org/css-color-adjust/#color-scheme-effect) の継承に従う。

| 条件 | 実測 document 幅 / scrollWidth | body background | 証拠 |
|---|---|---|---|
| 1280×800 / light | 1280 / 1280 | `oklch(1 0 0)` | [desktop-light.png](./desktop-light.png) |
| 1280×800 / dark | 1280 / 1280 | `oklch(0.145 0 0)` | [desktop-dark.png](./desktop-dark.png) |
| 400×720 / light | 400 / 400 | `oklch(1 0 0)` | [mobile-light.png](./mobile-light.png) |
| 400×720 / dark | 400 / 400 | `oklch(0.145 0 0)` | [mobile-dark.png](./mobile-dark.png) |

横方向のはみ出しがなく、desktop は columns、400px は overlay を使用した。日本語の見出しと英語のブランド、ステータスバーの折返しを確認した。プレビューは合成のレイアウト見本で、研究データではない。

モバイルで開閉ボタンからインスペクターを開き、初期フォーカスが「閉じる」に入ること、Tab が「ロビーへ戻る」→「閉じる」と循環し、Shift+Tab も逆向きに循環することを確認した。Escape と「閉じる」でパネルが消え、元の開閉ボタンへフォーカスが戻った。背景は操作対象から外れ、`aria-modal=true` の [mobile-dialog.png](./mobile-dialog.png) を保存した。幅変更時の stale inert/dialog cleanup と matchMedia 不在 fallback はコンポーネントテストで検証している。

実画面でロビー→プレビュー→戻る→進む、直接 URL、未知 URL の画面、混在 ID の `/project/real-project/board/layout-preview` が見本と誤表示されないことを確認した。初期ステータスは未接続・保存対象なし・ズーム未取得・Python 未起動であり、実接続や保存の完了を示さない。

アプリ由来の console error/warning はなかった。Chrome に導入済みの Zotero 拡張由来の接続エラーは切り分けた。画像は実画面のキャプチャであり、UI モックの生成画像ではない。
