# ADR-016: Pyodide の固定版をローカルサーバーから配信する

- ステータス: 採用。外部ネットワークを遮断した headless Chromium で NumPy / SciPy / pandas / matplotlib の import を確認
- 日付: 2026-10-27
- 関連 Issue: #26（親 #2）、前提 #25（ADR-015）、製品への統合は E10（#77）
- 対象: concept.md §5.1、implementation-plan.md §0 / §1（静的配信に Pyodide アセット）、ADR-008、ADR-011
- 置き換える範囲: ADR-015 の「`loadPyodide({ indexURL })` と `loadPackage("numpy")` の取得先は jsDelivr CDN」。Worker・停止・世代管理など ADR-015 のその他の決定は変更しない

## 文脈

concept.md §5.1 は Pyodide を固定版で配布し、CDN の `latest` / `dev` を参照せず、主要パッケージを同梱・キャッシュすると定めている。ADR-015 の spike は版を固定したうえで jsDelivr から取得しており、オフライン動作・同梱・integrity 検証を #26 に残した。ADR-008 によりサーバープロセスが常に存在し、ADR-011 / #38 で `/pyodide/*` を `apps/web/dist/pyodide` から配信する経路だけが用意されていた。

## 決定

1. **取得はビルド時・postinstall ではなく明示コマンド `pnpm pyodide:fetch`** にする（`tools/pyodide/fetch.ts`）。配置先は `apps/web/public/pyodide/v<版>/` で、git には含めない。Vite dev server はそのまま配信し、`vp build` が `dist/pyodide/` へコピーし、本番サーバーが `/pyodide/` で配信する。
   - postinstall は採らない。`pnpm install` のたびにネットワークへ出ること、CI の `check / test / build` が Pyodide を必要としないのに十数〜数十 MB を取得することが理由。
   - ビルド時取得も採らない。オフラインでのビルドが不可能になり、ビルドの再現性が外部 CDN の可用性に依存するため。
2. **ランタイムは npm パッケージ `pyodide@314.0.7` からコピー**する。`pyodide.mjs`、`pyodide.asm.mjs`、`pyodide.asm.wasm`、`python_stdlib.zip`、`pyodide-lock.json` は npm パッケージに含まれ、`pnpm-lock.yaml` の integrity で改変を検出できる。npm パッケージのこれらのファイルは公式リリース `pyodide-314.0.7.tar.bz2` の同名ファイルと sha256 が一致することを確認した。
3. **wheel は lock の sha256 と一致したものだけを置く**。取得元は既定で `https://cdn.jsdelivr.net/pyodide/v314.0.7/full/`、`--source` で https URL か展開済みの公式リリースディレクトリを指定できる（http は拒否）。検証済みのバイト列を一時ファイル経由で置き換え、既に一致するファイルは再取得しない。sha256 の基準は手順 2 の npm 由来の lock なので、CDN やミラーの内容を信頼しなくてよい。これで ADR-015 に残っていた「runtime と lockfile の integrity 検証は未実装」を解消する。Pyodide の loader も `loadPackage` 時に lock の sha256 を `fetch` の `integrity`（SRI）に渡して wheel を検査する（`checkIntegrity` の既定値）。
4. **パッケージは許可リスト**（`numpy` / `scipy` / `pandas` / `matplotlib`、concept.md §5.1 の MVP 優先パッケージ）とその依存閉包に限る。既定は `numpy` のみ。lock 上のファイル名は `^[A-Za-z0-9_][A-Za-z0-9_.+-]*\.(whl|zip)$` で検証し、版ディレクトリの外へ書き出さない。安定版 `x.y.z` 以外（alpha など）は配置しない。
5. **キャッシュヘッダ**: `/pyodide/v<x.y.z>/` 配下は `Cache-Control: public, max-age=31536000, immutable`。版ごとのディレクトリの内容は手順 2〜3 で固定されるため。版のない `/pyodide/*`、web の HTML・asset は従来どおり `no-cache`。404 は immutable にしない。
6. **spike の Worker は同一オリジンの `/pyodide/v314.0.7/` を indexURL にする**。外部 CDN への fallback は持たない。配布物がなければロードは明示エラーになり、案内に従って `pnpm pyodide:fetch` を実行する。

COOP / COEP、CSP（`wasm-unsafe-eval`、`worker-src 'self'` など）は ADR-015 のとおり terminate 方式で不要なため導入しない。製品の CSP は E10 / #45 で決める。

## 結果（計測）

2026-10-27、Linux コンテナ上の headless Chromium（`HeadlessChrome/153.0.8010.12`）。本番と同じ `createAppServer` が spike の build（`apps/web/dist-pyodide-spike/`）と配布物を 127.0.0.1 で配信した。ブラウザーは到達不能なプロキシ（`--proxy-server=http://127.0.0.1:9`）で起動し、loopback 以外の通信はネットワーク層で失敗する。同条件で jsDelivr への `fetch` が `Failed to fetch` になることを確認し、それ以外に loopback 外への要求は 0 件だった。各計測は新しいプロフィール（ディスクキャッシュ空）で開始した。詳細と再現スクリプトは [evidence](../evidence/26-pyodide-offline/README.md)。

**サイズ**（Pyodide 314.0.7、Python 3.14.2、ABI `2026_0`。依存閉包の wheel 合計。ランタイム 5 ファイル 13,531,207 bytes は別）

| 要求パッケージ | 版 | 閉包のパッケージ数 | wheel 合計 |
|---|---|---|---|
| numpy | 2.4.6 | 1 | 2,960,568 bytes |
| scipy | 1.18.0 | 2（+numpy） | 16,990,318 bytes |
| pandas | 3.0.2 | 5（+numpy, python-dateutil, pytz, six） | 7,889,748 bytes |
| matplotlib | 3.10.8 | 12（+numpy, contourpy, cycler, fonttools, kiwisolver, packaging, pillow, pyparsing, python-dateutil, pytz, six） | 13,266,929 bytes |
| 4 つすべて | — | 14 | 31,474,428 bytes（ランタイム込み 45,005,635 bytes） |

**ロード時間**（ms。runtime = loader import〜`loadPyodide` 完了、loadPackage = wheel 取得・展開、import = `import <pkg>` の初回実行。1 回ずつの値で保証値ではない）

| パッケージ | runtime 初回 / 再訪 | loadPackage 初回 / 再訪 | import 初回 / 再訪 | サーバー配信 初回 / 再訪 |
|---|---|---|---|---|
| numpy | 2,330 / 1,951 | 431 / 386 | 507 / 504 | 6 件 16.5 MB / 0 件 |
| scipy | 2,335 / 2,002 | 2,021 / 2,055 | 704 / 592 | 7 件 30.5 MB / 0 件 |
| pandas | 2,430 / 1,895 | 877 / 930 | 3,233 / 3,083 | 10 件 21.4 MB / 0 件 |
| matplotlib | 2,373 / 1,994 | 1,073 / 1,042 | 1,716 / 1,674 | 17 件 26.8 MB / 0 件 |

再訪は同じプロフィールで新しいページを開いた値で、`immutable` によりサーバーへの要求は 0 件になった。loopback 配信のため転送時間は小さく、時間の大半は Wasm のコンパイル・wheel の展開・import である。遠隔の CDN や遅い回線での値ではない。この計測は main thread で行い、spike UI の Worker 計測とは別である。

**spike UI**（module Worker）: 明示ロード前の `/pyodide/` 要求は 0 件。ロード 2,870.2 ms、NumPy の結果 sum=50,005,000 / mean=5,000.5 / count=10,000 / NumPy 2.4.6 / Python 3.14.2、UI 往復 633.3 ms。無限ループ → Stop → 再ロードでは新しい Worker のロード 2,434.8 ms、サーバーへの要求 0 件、同じ結果。サーバーを停止した状態でロードすると Worker の module 取得が失敗して `error` になり、外部へ迂回しない。

**観察**: 非永続の browser context（シークレット相当のメモリキャッシュ）では 9.6 MB の `pyodide.asm.wasm` や SciPy の wheel が再訪時も再取得された。ディスクキャッシュのある通常プロフィールでは再取得されない。キャッシュがなくてもローカルサーバーから取得できるので動作には影響しない。Playwright の `route` は HTTP キャッシュを無効にするため、キャッシュの計測では使わない。

## ライセンス

配信物はすべて無改変で再配布する。各 wheel は `*.dist-info/` にライセンス文書を含み、そのまま配信される。法的レビューではなく、配布物のメタデータの確認である。

| 対象 | ライセンス（メタデータ） |
|---|---|
| Pyodide（loader・`pyodide.asm.*`） | MPL-2.0（npm `package.json`）。ソースは [pyodide/pyodide 314.0.7](https://github.com/pyodide/pyodide/tree/314.0.7) |
| CPython 3.14 標準ライブラリー・インタープリター | PSF License |
| numpy 2.4.6 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| scipy 1.18.0 / pandas 3.0.2 / contourpy / kiwisolver / cycler | BSD 系 |
| matplotlib 3.10.8 | Matplotlib License（PSF ベース） |
| pillow 12.2.0 | MIT-CMU |
| fonttools / pyparsing / pytz / six | MIT |
| python-dateutil | Apache-2.0 / BSD のデュアル |
| packaging | Apache-2.0 OR BSD-2-Clause |

いずれも再配布を許可する。MPL-2.0 は無改変の再配布でソースの入手先の告知を求めるため、本 ADR と README から上記のソースへの参照を残す。Pyodide 本体の npm パッケージには LICENSE ファイルが含まれていない点は、製品として配布する E8 / E10 で NOTICE の整備とあわせて再確認する。

## 代替案

- **CDN を実行時に参照し続ける**: オフライン・LAN 内で動かず、concept.md §5.1 と食い違う。不採用。
- **配布物を git にコミットする**: 4 パッケージで約 45 MB、版更新のたびに履歴が増える。不採用。
- **Git LFS / 別リポジトリ**: 運用コストに見合わない。npm + sha256 検証で同等の再現性が得られる。
- **公式リリース tarball（337 MB）を常に取得する**: 必要なのは数十 MB で過大。`--source` で展開済みディレクトリを指定する経路としてだけ残す。
- **Service Worker でオフラインキャッシュ**: ローカルサーバーが常に存在する前提（ADR-008）では不要。サーバーが止まった状態でのオフライン実行は要件にない。

## 残る課題

- 実 Chrome（GUI）・Firefox・Safari、遅い端末での計測は未実施。上記は 1 回ずつの値。
- 製品 App への統合、パッケージ許可リストの UI、サイズの明示（concept.md §5.2）は E10。
- `pnpm pyodide:fetch` を `pnpm start` 前の手順として案内するのは README のみ。E8 の配布形態で自動化を再検討する。
- 版を上げるときは `pnpm-workspace.yaml` の catalog、`apps/web/src/pyodide-spike/protocol.ts` の `pyodideVersion` を同時に変え、`pnpm pyodide:fetch` を再実行する。旧版のディレクトリは手動で削除する。

## 再現コマンド

```sh
pnpm install --frozen-lockfile
pnpm pyodide:fetch --packages numpy,scipy,pandas,matplotlib
pnpm --filter @discussion-room/web spike:pyodide:build
node docs/evidence/26-pyodide-offline/offline-check.mjs docs/evidence/26-pyodide-offline
```

## 参照（2026-10-27 確認）

- [Pyodide: Downloading and deploying Pyodide](https://pyodide.org/en/stable/usage/downloading-and-deploying.html)
- [Pyodide: Loading packages](https://pyodide.org/en/stable/usage/loading-packages.html)
- [Pyodide 314.0.7 リリース](https://github.com/pyodide/pyodide/releases/tag/314.0.7)
- [npm pyodide 314.0.7](https://www.npmjs.com/package/pyodide/v/314.0.7)
- [MDN Cache-Control `immutable`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control#immutable)
- [Playwright `page.route`（routing は HTTP キャッシュを無効にする）](https://playwright.dev/docs/api/class-page#page-route)
