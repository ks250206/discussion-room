# Issue #26: 外部ネットワーク遮断下の Pyodide ローカル配信の証拠

2026-10-27、Linux コンテナ上の headless Chromium（`HeadlessChrome/153.0.8010.12`、viewport 1280 × 900）で [offline-check.mjs](./offline-check.mjs) を実行した。結果の全体は [report.json](./report.json)（ポート番号のみ伏せた）。判断は [ADR-016](../../decisions/016-pyodide-local-distribution.md)。

## 条件

- 配布物: `pnpm pyodide:fetch --packages numpy,scipy,pandas,matplotlib --source <展開した公式 pyodide-314.0.7.tar.bz2>`。この環境から jsDelivr には到達できないため、公式リリース（sha256 `192b5864e6e6d30ab074861af800cb8b4acb0998ef0f9342c3367448aeb86645`）を展開して取得元にした。全 14 wheel が lock の sha256 と一致した。
- 配信: `pnpm --filter @discussion-room/web spike:pyodide:build` の成果物を、本番と同じ `createAppServer`（`webRoot` = `apps/web/dist-pyodide-spike`、`pyodideRoot` = その `pyodide/`）で 127.0.0.1 に配信。サーバーが返したパス・バイト数を記録した。
- 遮断: Chromium を到達不能なプロキシ `--proxy-server=http://127.0.0.1:9` で起動。loopback は Chromium の既定でプロキシを経由しないため、ローカルサーバーにだけ届く。ページから jsDelivr の lockfile への `fetch` は `Failed to fetch` になった。記録した loopback 外の要求はこの確認用 `fetch` の 1 件だけ。
- キャッシュ: 各計測は空のプロフィール（`launchPersistentContext`、ディスクキャッシュあり）で開始。`route` は HTTP キャッシュを無効にするため使っていない。

## 画面

| ファイル | 内容 |
|---|---|
| [numpy-offline-first.png](./numpy-offline-first.png) | 明示ロード → NumPy。結果 JSON（sum=50,005,000、mean=5,000.5、count=10,000、NumPy 2.4.6、Python 3.14.2）、ロード 2,870.2 ms、UI 往復 633.3 ms |
| [numpy-offline-restarted.png](./numpy-offline-restarted.png) | 無限ループ → Stop → 再ロード（起動時の無効化カウンター 3）→ NumPy。ロード 2,434.8 ms、UI 往復 551.5 ms。この間のサーバーへの要求は 0 件（immutable キャッシュ） |
| [server-down-error.png](./server-down-error.png) | サーバー停止後に新しいプロフィールでロード。Worker の module 取得に失敗して `error`。外部への迂回はない |

ページを開いてから明示ロードまでの `/pyodide/` への要求は 0 件だった。

## パッケージごとの計測

ADR-016 の表を参照。main thread で `import("/pyodide/v314.0.7/pyodide.mjs")` → `loadPyodide` → `loadPackage(<pkg>)` → `import <pkg>` を測った。各パッケージで初回（空プロフィール）と再訪（同じプロフィールの新しいページ）の 2 回、1 回ずつの値である。再訪ではサーバーへの要求が 0 件になった。import した版は numpy 2.4.6、scipy 1.18.0、pandas 3.0.2、matplotlib 3.10.8。

## 記録していないこと

- GUI の Chrome、Firefox、Safari、mobile。
- 遅い回線・遠隔サーバーでの時間。loopback 配信のため転送はほぼゼロで、時間の大半は Wasm コンパイルと展開・import。
- 非永続 context（メモリキャッシュ）では `pyodide.asm.wasm`（9.6 MB）や SciPy wheel が再訪時も再取得された。最初の試行で観察し、計測はディスクキャッシュのある永続 context に切り替えた。
