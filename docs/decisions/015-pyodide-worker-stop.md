# ADR-015: Pyodide module Worker と terminate による停止・再起動

- ステータス: 採用。実 Chrome で NumPy 計算・無限ループ中の UI 応答・Stop・再生成後の再計算を確認
- 日付: 2026-10-27
- 関連 Issue: #25（親 #2）、配布・オフラインは #26、実製品への統合は E10
- 対象: concept.md §5、implementation-plan.md §0（Python はクライアント内実行のまま）

## 文脈と決定

重い Python 計算と無限ループが UI を止めないこと、Stop 後に新しい環境で再実行できることを検証する。通常の製品 App に機能を入れず、`apps/web/pyodide-spike.html` と専用 Vite 設定に隔離する。

Pyodide **314.0.7** を npm 依存・CDN パスともに固定する。2026-10-27 に npm `dist-tags` の `latest=314.0.7`、公式 stable 文書の版表示、公式 changelog と公開 lockfile を確認した。旧系列 `0.29.5` と開発版 `315.0.0-alpha.2` は採用しない。固定版 lockfile の Python は **3.14.2**、NumPy は **2.4.6**、ABI は `2026_0`。公開配布物の確認に加え、以下の実 Chrome の計算結果でも Python / NumPy の版を確認した。

- module Worker は「CDN から環境をロード / 再起動」の明示クリックで生成する。Worker 以外に Pyodide をロード・実行する経路を設けない。main thread fallback はない。
- JS loader は固定版 npm パッケージから Worker chunk にバンドルする。`loadPyodide({ indexURL })` と `loadPackage("numpy")` の取得先は `https://cdn.jsdelivr.net/pyodide/v314.0.7/full/`。初回に説明を表示し、ページ表示だけでは取得しない。CDN に通常の接続情報は届く。
- 固定の NumPy 計算、無限ループ、Python 例外だけを実行する。任意コード・研究データの入力欄、外部計算 API、AI コード自動実行、結果保存、Room 同期はない。コードと合成数値はローカル Worker 内にある。Worker を一般の悪意あるコードに対する完全なサンドボックスとみなさない。
- Stop はロード中・計算中に利用でき、イベントリスナーを外して `terminate()` し、世代を無効化する。停止後の明示ロードで**新しい Worker を生成**する。次のロードの同意クリック前に自動再ダウンロードしないため、Stop 直後には再生成しない。Python の変数状態は破棄される。状態は `stopped` と表示し、停止処理を Python の正常終了と混同しない。
- React の effect setup がコントローラーを所有し、cleanup で購読解除・dispose を行う。StrictMode や Fast Refresh が UI state を維持して effect を再実行しても、次の setup で新しいコントローラーを作り、破棄済みのインスタンスを再利用しない。専用エントリも StrictMode を有効にした。StrictMode 実描画での実行と、UI state を保持した effect 再設定の回帰テストを追加した。
- 無効化カウンターと単調増加する実行 ID で旧 Worker のキュー済み応答、前回実行の結果、重複応答を排除する。単一実行のみ許可し、ロード・送信・Python・Worker・デシリアライズエラーから明示再起動できる。
- Worker 境界は `unknown` を Valibot で検証する。固定プログラムの JSON 結果が 8,192 文字を超えた場合は明示エラーにし、結果の一部を成功として返さない。エラー表示も最大 8,192 文字に制限し、stdout/stderr を蓄積・配信しない。PyProxy を UI に渡さない。

## 計測の意味と現時点の証拠

環境ロードは UI のクリックから NumPy wheel の `loadPackage()` 完了を含む ready 応答までを UI 内の `performance.now()` 同士で測る。`loadPackage()` は wheel のロード・インストールまでであり Python の `import numpy` は実行しない。実行往復も UI 内で、Worker 内では **`runPythonAsync` 全体**の時間を測る。固定プログラムの `import json, sys, numpy as np` と配列作成・合計・平均・JSON 生成をすべて含む。下表の成功 3 回はいずれも新しい Worker の初回実行であり、初回 NumPy import のコストを含む。合計・平均の演算だけの性能測定ではない。ready までのロード時間だけで停止後の最初の結果が得られるまでの費用を評価しない。異なる時計の値を引かない。ロード値には Worker 起動、CDN 取得、初期化を含む。ブラウザーキャッシュ有無・回線・端末の影響があるため単一回を保証値にしない。

WASM メモリは固定版 Emscripten の内部 `runtime._module.HEAPU8.buffer.byteLength` を Valibot で存在確認して取得する。これは **線形メモリの確保容量 bytes** であり、Python の実使用量、JS ヒープ、RSS、ブラウザープロセス全体のメモリではない。内部 API が取得できない場合は `null` と「取得不可 / 未取得」を表示する。RSS / 実使用メモリの対応 API は実装していないので明示的に取得不可とする。ゼロで補完しない。Worker 終了後の OS メモリ返却時刻を保証しない。

| 確認項目 | 証拠 / 結果 |
|---|---|
| 固定配布物の版と NumPy wheel | npm `pnpm view pyodide dist-tags --json`、公式 CDN lockfile 確認済み |
| fake Worker のライフサイクル | ロード中 Stop、古い世代・ID・重複応答、例外・ロード失敗・Worker 異常・送信失敗、dispose、未計測 `null` を unit test で確認 |
| ローカル静的検証 | frozen install、`vp check`、`vp test`、`vp build`、`vp run -r build`、専用 spike build が成功。preview の HTML と Worker JS は HTTP 200。最終件数は evidence README を参照 |
| ブラウザー・端末・日時・キャッシュ条件 | 2026-10-27、ローカル macOS 上の実 Chrome を Cua から操作、built preview `http://127.0.0.1:4275/pyodide-spike.html`、viewport 1800 × 873。Chrome / OS の正確な版と端末仕様は未記録。キャッシュを消した条件ではないため cold load と呼ばない |
| セッション内の初回ロード実測 | **6,888.5 ms**。NumPy ロード完了時の WASM 確保容量 **37,748,736 bytes** |
| 初回 NumPy 計算 | sum=**50,005,000**、mean=**5,000.5**、count=**10,000**、NumPy **2.4.6**、Python **3.14.2**。UI 往復 **1,748.2 ms**、Worker Python 実行全体（初回 NumPy import 含む） **1,747.6 ms** |
| 初回 NumPy 後の WASM 容量 | **45,350,912 bytes**。RSS / 実使用量は取得不可 |
| 無限ループ中 UI heartbeat / 操作 | `running` のまま heartbeat **1648 → 1732**、応答テスト **1 → 2**、配色切替が動作した。light と dark の画面証拠あり。desktop で横スクロールなし。spike の mobile は未検証 |
| Stop → 再ロード → NumPy | Stop 後 `stopped`、実行ボタン無効、結果空欄を確認。新 Worker（起動時の無効化カウンター **7**）で ready、ロード **4,918.1 ms**。NumPy は同じ正しい結果、UI 往復 **1,010.7 ms**、Worker Python 実行全体（初回 NumPy import 含む） **1,009.2 ms**、確保容量 **45,350,912 bytes** |
| Python 例外 → 再ロード → NumPy | 合成 `ValueError` を表示して `error`。明示再起動後、起動時の無効化カウンター **9** で ready、ロード **4,267.1 ms**、確保容量 **37,748,736 bytes**。NumPy は同じ正しい結果、UI 往復 **998.3 ms**、Worker Python 実行全体（初回 NumPy import 含む） **988.9 ms**、確保容量 **45,350,912 bytes** |
| console / request の確認範囲 | native Worker error 発生時点の Chrome `dev.logs(limit: 12)` の warn/error は `[]`。全過程の console・network の網羅的監査は未実施。ページ表示直後の通信先を記録した HAR はない |
| 画面証拠 | [evidence README](../evidence/25-pyodide-worker/README.md) と 7 枚の PNG |

**カウンターの意味:** UI の「起動時の無効化カウンター」は、Worker の生成回数ではなく、その起動時点の無効化トークンを表示する。`retire()` は Worker の有無にかかわらず内部カウンターを増やすため、初回 initialize は 1、正常な Stop で内部値は 2、次の initialize で表示は 3 になる。Stop / error 直後の表示は最後の起動時の値を保持する。error と再試行でも増え、コントローラーを作り直すと 0 から始まる。この値を Worker 台数・再起動回数・失敗回数と解釈しない。既存 PNG の旧ラベル「Worker 世代」も同じトークンを指す。レビュー後の正常な Stop → 再ロードの画面が 3 なのはこのためである。

**検証環境の中断:** Stop 後の最初の再ロード 2 回は native Worker error となった。検証担当が `curl` で preview の 4275 ポートが配信停止していることを確認し、preview を再起動した後に再ロードと NumPy が成功した。成功画面の起動時トークン 7 は、正常な Stop / 再ロードに加え、この間の error / 再試行でも `retire()` が呼ばれた結果である。配信停止は検証ハーネスの事象として記録し、成功した再実行の前に起きた失敗を隠さない。エラーの観測だけでコードや CDN の障害と断定しない。

ロード中 Stop と古い応答の排除は fake Worker unit test で検証した。実 Chrome の Stop は無限ループ中で実施した。unit test のみの項目と実ブラウザーの項目を区別する。

spike build は npm loader 内の Node 向け分岐（`node:fs`、`node:path` など）がブラウザー用に externalized されたという Vite 警告を出す。実 Chrome では NumPy と停止後の再実行が動いた。全ブラウザー互換性をこの 1 回から保証しない。

## 公式 interrupt buffer の要件と代替案

公式の割り込みは Worker で `SharedArrayBuffer` を共有し、Pyodide 側に `setInterruptBuffer()` を設定して、UI 側から値 **2（SIGINT）** を書く。通常は `KeyboardInterrupt` を起こし、Pyodide が buffer を 0 に戻す。前回の残留信号を避けるため実行前もクリアする。C 拡張は `PyErr_CheckSignals()`、JS ブリッジの長い処理は `checkInterrupt()` などの協調が必要で、すべてのネイティブ処理への即時割り込みを保証しない。

SharedArrayBuffer の共有には secure context（HTTPS または信頼できる localhost）と cross-origin isolation が必要。典型的なヘッダは:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`Permissions-Policy: cross-origin-isolated` によって拒否されていないこと、window と Worker で `crossOriginIsolated === true` を確認することも必要。ヘッダを付けるだけでは十分とは限らず、CDN を含む全 cross-origin リソースに適切な CORS または CORP、Worker へのポリシー適用を確認する。COEP は外部画像やモジュール等をブロックし得る。`credentialless` も仕様上の代替だが、この spike では検証していない。

この spike は COOP/COEP を追加せず、**SharedArrayBuffer を使わない terminate を標準経路**にする。これは停止後に環境を捨てる代わりに、通常の UI からロード中・無限ループ中の Worker を止められる方式。公式 interrupt buffer は要件調査までで、実装・動作確認済みとはしない。E10 で状態保持や停止遅延の要求が出たときに協調割り込みを追加し、最終手段として terminate を残す。

## 再現コマンド

```sh
pnpm install --frozen-lockfile
pnpm exec vp check
pnpm exec vp test
pnpm exec vp build
pnpm exec vp run -r build
pnpm --filter @discussion-room/web spike:pyodide:build
pnpm --filter @discussion-room/web spike:pyodide
# http://127.0.0.1:4175/pyodide-spike.html
# ビルド出力を配信する場合:
pnpm --filter @discussion-room/web spike:pyodide:preview
# http://127.0.0.1:4275/pyodide-spike.html
```

ページ表示時に CDN へのリクエストがないことを確認し、明示ロード → NumPy → 無限ループ → 応答ボタン・配色操作 → Stop → 明示再ロード → NumPy → 例外 → 再ロードを順に試す。ロード直後にも Stop して旧 ready が状態を上書きしないことを確認する。通常の `vp build` の出力は変えず、この spike の出力は `apps/web/dist-pyodide-spike/` に隔離する。

## 結果と残る課題

停止方式・世代管理・測定の定義を固定し、実 Chrome で NumPy 計算・無限ループ中の UI 応答・Stop 後の新 Worker での再計算・Python 例外からの再起動を確認した。初回は外部取得が必要である。固定配布物の同梱とキャッシュ、オフライン再起動、CSP、パッケージ許可リスト、実行記録・タイムアウト・任意入力はこの spike の完了範囲外。とくに #26 の同梱・オフライン可否は本結果から推論しない。CDN の runtime と lockfile 自体に対する独立した integrity 検証は未実装であり、版固定は改変検証の代用ではない。#26 で同梱・CSP とともに検討する。Pyodide はこの spike だけが使用する `apps/web` の dependencies にあり、製品 App は import していない。devDependencies への配置や E10 での製品依存への移行も #26 / E10 で再検討する。

## 参照（2026-10-27 確認）

- [Pyodide 公式 Worker](https://pyodide.org/en/stable/usage/webworker.html)（確認時 Version 314.0.7、module Worker 必須）
- [公式 bundler / indexURL](https://pyodide.org/en/stable/usage/working-with-bundlers.html)
- [公式割り込み](https://pyodide.org/en/stable/usage/keyboard-interrupts.html)
- [公式 changelog](https://github.com/pyodide/pyodide/blob/314.0.7/docs/project/changelog.md)
- [固定版 lockfile](https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide-lock.json)
- [npm 固定版](https://www.npmjs.com/package/pyodide/v/314.0.7)
- [MDN SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
- [MDN COEP と cross-origin isolation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)
- [React 公式 StrictMode と effect の追加 setup / cleanup](https://react.dev/reference/react/StrictMode)
