# Issue #25: 実 Chrome の Pyodide module Worker 証拠

2026-10-27、親タスクの検証担当が Cua からローカル macOS の実 Chrome を操作し、`pnpm --filter @discussion-room/web spike:pyodide:build` の成果物を `http://127.0.0.1:4275/pyodide-spike.html` で確認した。viewport は 1800 × 873、desktop の light / dark。Chrome / OS の正確な版、端末仕様は未記録。キャッシュを明示消去した条件ではなく、cold load / 完全オフラインの証拠ではない。spike の mobile は未検証。

| ファイル | 確認できる内容 |
|---|---|
| [numpy-first.png](./numpy-first.png) | 起動時トークン 1（画像の旧「世代」表示）、初回 NumPy 結果、ロード 6,888.5 ms、UI 往復 1,748.2 ms、Worker Python 実行全体（初回 NumPy import 含む）1,747.6 ms、WASM 確保容量 45,350,912 bytes、`crossOriginIsolated=false` |
| [infinite-responsive.png](./infinite-responsive.png) | `running` の無限ループ中、dark 配色、応答テスト操作後の画面 |
| [stopped.png](./stopped.png) | Stop 後の `stopped`、実行ボタン無効、結果空欄、新規ロード案内 |
| [numpy-restarted.png](./numpy-restarted.png) | 新 Worker（起動時の無効化カウンター 7）で NumPy の同じ正しい結果を再取得 |
| [exception-recovered.png](./exception-recovered.png) | 合成 ValueError 後の明示再起動、新 Worker（起動時の無効化カウンター 9）で NumPy の同じ正しい結果を再取得 |

すべての NumPy 成功結果は sum=50,005,000、mean=5,000.5、count=10,000、NumPy 2.4.6、Python 3.14.2。表示された期待値だけを実行証拠とはせず、結果 JSON と `ready` を確認した。

以下は検証担当が画面操作中に読み取った数値・遷移であり、各 PNG が全数値・全時点を同時に写しているという意味ではない。

- 初回 ready 時の WASM 確保容量: 37,748,736 bytes。初回 NumPy 後: 45,350,912 bytes。
- 無限ループの `running` 中に heartbeat 1648 → 1732、応答テスト 1 → 2、配色切替が動いた。desktop の横スクロールは発生しなかった。heartbeat は応答確認でありフレーム性能の測定ではない。
- Stop 後、新 Worker（起動時の無効化カウンター 7）のロード: 4,918.1 ms。再 NumPy の UI 往復: 1,010.7 ms、Worker Python 実行全体（初回 NumPy import 含む）: 1,009.2 ms、確保容量: 45,350,912 bytes。
- 合成 Python ValueError の表示と `error` を確認。明示再起動で起動時の無効化カウンター 9、ロード: 4,267.1 ms、ready 容量: 37,748,736 bytes。再 NumPy の UI 往復: 998.3 ms、Worker Python 実行全体（初回 NumPy import 含む）: 988.9 ms、確保容量: 45,350,912 bytes。

Stop 後の最初の再ロード 2 回は native Worker error となった。検証担当が `curl` で preview の 4275 ポート停止を確認し、preview を再起動した後に成功した。これは検証ハーネスの配信中断として残す。表示値は Worker の生成回数ではなく、起動時点の無効化トークンである。初回 1 → Stop で内部値 2 → 次の initialize で表示 3 となり、error と再試行でも増える。Stop / error 直後の表示は最後の起動時の値を保持する。成功画面の 7 は正常な Stop / 再ロードに加えて error / 再試行でも retire が呼ばれた結果である。既存画像の旧ラベル「Worker 世代」はこのトークンを指し、台数・再起動回数・失敗回数ではない。native Worker error 時点で Chrome `dev.logs(limit: 12)` の warn/error は `[]` だったが、全過程の console / request の網羅的監査は行っていない。HAR は保存していない。

メモリ値は Emscripten の WASM 線形メモリ確保容量であり、実使用量・RSS・ブラウザープロセス全体の容量ではない。対応 API を実装していない RSS / 実使用量は取得不可。UI 往復は UI 内、Worker Python 実行全体の時間は Worker 内で `performance.now()` の差を取った。別々の時計を引いていない。`runPythonAsync` 全体を測るため、いずれの新 Worker 初回実行も初回 `import numpy` を含む。合計・平均の演算だけの測定ではない。環境ロードは wheel のロード・インストールまでであり、この Python import のコストを含まない。

ロード中 Stop・古い応答・異常復帰の unit test と全体静的検査は [ADR-015](../../decisions/015-pyodide-worker-stop.md) の再現コマンドで確認する。最終 main (`4b026c9`) への追従後に frozen install、`vp check`（118 files formatted / 89 lint・型検査 files）、`vp test`（27 files / 639 tests）、通常 build、全パッケージ build、専用 spike build、`git diff --check` が成功した。最初の main 追従前後では専用ビルドの出力名 `python.worker-spJyzznR.js` / `pyodide-spike-D98NzBjB.js` / `pyodide-spike-CnSsaraG.css` は同じだった。その後のレビュー対応で StrictMode を有効化し、effect 所有のコントローラーへ修正し、過大出力を明示エラーに変更した。上記 5 枚はレビュー対応前の画面であり、画面内の旧「Worker 内の Python 計算時間」は本書のとおり「初回 NumPy import を含む Python 実行全体」と読み替える。合計・平均のプログラム自体は変更していない。レビュー対応後も frozen install、`vp check`（120 files formatted / 91 lint・型検査 files）、`vp test`（29 files / 642 tests）、通常 build、全パッケージ build、専用 spike build、`git diff --check` が成功した。レビュー後の dedicated build は `python.worker-BmONQ5r7.js` / `pyodide-spike-C7Bi8y2Y.js`。StrictMode と effect 再設定は RTL 回帰テストで確認し、実 Chrome の再確認結果は次節に記録した。


## レビュー修正後の実 Chrome 再確認

StrictMode を有効にした dedicated build `pyodide-spike-C7Bi8y2Y.js` / `python.worker-BmONQ5r7.js` を同じ preview で再読み込みし、明示ロード→NumPy→無限ループ→応答ボタン→Stop→明示再ロード→NumPy を確認した。初回はロード 5,238.4 ms、UI 往復 1,287.5 ms、初回 import を含む Python 実行全体 1,286.3 ms。Stop 後は新 Worker（起動時の無効化カウンター 3）、ロード 5,087.6 ms、UI 往復 1,146.9 ms、初回 import を含む Python 実行全体 1,146.0 ms。どちらも同じ正しい結果 JSON、実行後の WASM 確保容量 45,350,912 bytes を確認した。無限ループ中の応答ボタンは 0→1、Stop 後は stopped になり結果が消え、再ロード後は ready に戻った。

[review-fixed-numpy.png](./review-fixed-numpy.png) と [review-fixed-restarted.png](./review-fixed-restarted.png) はレビュー修正後の計算結果を含む画面である。ブラウザーのキャッシュ状態・refresh rate は未記録であり、初回 import の時間と純粋な合計演算の時間を分離した測定ではない。実 build では本番 React のため、開発 StrictMode の effect replay 自体の証拠は別途 RTL 回帰テストに限定する。Fast Refresh の実 dev server 操作は未検証。

最終の軽微修正では heartbeat を live region ではない `span` にし、「Worker 世代」を「起動時の無効化カウンター」へ改称した。計算・停止ロジックは変更していない。`vp check`、spike の関連 3 files / 13 tests、専用 build、`git diff --check` が成功した。最新 UI は `pyodide-spike-Cnj1Ee88.js`、Worker は再確認時と同じ `python.worker-BmONQ5r7.js`。既存画像はラベル変更前の証拠として保持する。

最終 UI `pyodide-spike-Cnj1Ee88.js`（Worker は検証済みの `python.worker-BmONQ5r7.js`）を再読み込みし、計時ラベルと heartbeat の span を確認した。[final-labels.png](./final-labels.png) はロード前の計測欄で、未取得を未取得のまま表示している。新たな計算測定値の証拠ではない。
