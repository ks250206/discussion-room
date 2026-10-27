# discussion-room

研究仮説・予測・実験計画をボード上で議論するためのローカルサーバー + ブラウザアプリ。設計は [docs/concept.md](docs/concept.md) と [docs/implementation-plan.md](docs/implementation-plan.md) を参照。

## 必要環境

- Node.js 24（`.node-version`）
- pnpm 12.15.0（`packageManager`）
- [Vite+](https://viteplus.dev/)（`vp`）

## 構成

| パス                 | 内容                                                 |
| -------------------- | ---------------------------------------------------- |
| `apps/web`           | React + TypeScript の Web クライアント（画面シェル） |
| `apps/server`        | Hono のローカルサーバー（API・静的配信・`/ws` echo） |
| `packages/domain`    | ドメインの型・スキーマ・純粋関数                     |
| `packages/protocol`  | WebSocket メッセージのスキーマ                       |
| `packages/materials` | 元素・イオン半径・組成計算                           |

プロトコル package の v1 メッセージ契約・JSON 安全性・サイズ上限は [docs/protocol.md](docs/protocol.md) を参照。`/ws` transport への組み込みは後続 issue。

## コマンド

```sh
pnpm install

vp check                          # fmt + lint + typecheck（規約: docs/coding-conventions.md）
vp test                           # 全パッケージのテスト
vp build                          # apps/web のビルド（defaultPackage）
vp run -r build                   # 全パッケージの build スクリプト

vp run --filter ./apps/web dev    # web dev server
vp run --filter ./apps/server dev # server（node --watch）
pnpm dev                          # web と server を同時起動
pnpm build                        # web と server の本番ビルド
pnpm start                        # ビルド済み web と API を単一ポートで配信
pnpm pyodide:fetch                # Pyodide ランタイムと wheel を配置（下記）
```

## 画面シェル

`apps/web` は上部バー、左ツール、中央キャンバス、右インスペクター、ステータスバーだけの骨格です。プロジェクトの作成、カード、キャンバス編集はありません。

| パス                                   | 画面                                       |
| -------------------------------------- | ------------------------------------------ |
| `/`                                    | ロビー。表示できるプロジェクトはありません |
| `/project/<projectId>`                 | プロジェクト。ID を表示します              |
| `/project/<projectId>/board/<boardId>` | ボード。両方の ID を表示します             |

サーバーのデータはまだ読み込んでいません。狭い画面ではインスペクターをモーダルとして開き、閉じるボタン・背景クリック・Escape で閉じると表示ボタンへフォーカスが戻ります。

ロビーの「レイアウトプレビュー」は画面構成の見本で、研究データではありません。見本のアドレスは `/project/layout-preview/board/layout-preview` です。

```sh
vp run --filter ./apps/web dev
```

既定は <http://localhost:5173/> です。上のパスをそのまま開くと、戻る・進むでも同じ画面に戻ります。

## 開発サーバー

`pnpm dev` は `vp run -r --parallel dev` で、web の Vite と server を同時に起動する。`dev` スクリプトが無いパッケージは対象にならない。

| プロセス | 既定の待ち受け                         | 役割                                         |
| -------- | -------------------------------------- | -------------------------------------------- |
| web      | Vite の既定（`http://localhost:5173`） | UI。`/api` と `/ws` をサーバーへプロキシする |
| server   | `http://127.0.0.1:8787`                | `/api/health` と開発用 `/ws` echo            |

server の `dev` は `node --watch src/main.ts`。エントリから import しているソース（`src/app.ts`、`src/config.ts`）が変わると再起動する。`--watch-path` は macOS と Windows だけで Linux では使えないため付けていない。

### 環境変数

`.env.example` をリポジトリルートの `.env` にコピーする。ファイルが無くても起動でき、そのときは例と同じ既定値になる。

サーバー（開発・本番共通）と Vite の開発用プロキシは、どちらも起動時にその `.env` を Node の `process.loadEnvFile` で読む（`--env-file` と同じ規則。`#` コメント、クォート、行頭の `export` が使える）。シェルに既にある変数は上書きしない。`.env.local` や `.env.development` は `PORT` / `HOST` / `DATA_DIR` には使わない。静的 build / preview では開発用プロキシを設定せず、これらの値の不備で静的ビルドを止めない。

| 変数       | 既定        | 意味                                                                                                           |
| ---------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `PORT`     | `8787`      | サーバーのポート。Vite のポートとは別                                                                          |
| `HOST`     | `127.0.0.1` | サーバーの待受アドレス。`127.0.0.1` / `::1` / `localhost` のみ許可。プロキシの接続先も同じ値。括弧は付けない   |
| `DATA_DIR` | `.data`     | リポジトリルートからの相対パス、または絶対パス。解決してログに出すだけで、ディレクトリもデータベースも作らない |

LAN 公開に必要な明示フラグと Room トークンは #45 で実装する。それまでは `0.0.0.0`、`::`、LAN アドレスなどへのバインドを拒否する。

Vite は `/api` とその配下を `http://HOST:PORT` へ、完全一致の `/ws` を `ws://HOST:PORT` へプロキシする（WebSocket は `ws: true`）。どちらもクエリ文字列を許可し、パスは書き換えない。`/apiary`、`/wsfoo`、`/ws/other` は転送しない。`HOST` が `::1` のときは URL のホストを `[::1]` にする。

`VITE_` で始まる変数だけがクライアントに露出する。`PORT` / `HOST` / `DATA_DIR` はブラウザへ出ない。Vite の `envDir` はリポジトリルート。

`.env` を変えたら `pnpm dev` を起動し直す。`.env` 自体の編集は server の watch 対象ではなく、再起動を起こさない。次のソース変更による再起動時には `.env` を読み直すが、Vite のプロキシ先は起動時の値のままになる。

`/ws` は開発用の echo で、受け取ったテキストとバイナリをそのまま返す。クエリ文字列はパスの一致から外す。サーバーを閉じる際は新規 WebSocket の受付を止め、既存接続を終了して HTTP サーバーの終了を妨げない。Room のプロトコルと SQLite 永続化は後続の issue で実装する。

## 本番相当の単一ポート起動（#38）

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
# CLI は環境変数を上書きする（= 記法も可）。
pnpm start --port 9000 --host 127.0.0.1 --data-dir ./local-data
```

`pnpm start` は `node apps/server/dist/main.mjs` を起動する。`apps/server` の `pnpm start` も同じ bundle を使う。`apps/web/dist/index.html` がない場合は、ビルドを案内する JSON エラーを出して終了する。`pnpm start` 自体はビルドを行わない。引数は `pnpm start --port 9000` と指定し、引数の前に追加の `--` 区切りを付けない（`pnpm start -- --port 9000` は拒否する）。

設定の優先順位は **CLI > シェルの環境変数 > リポジトリ `.env` > 既定値**。CLI は `--port` / `--host` / `--data-dir` をそれぞれ 1 回だけ受け付け、未知の引数、位置引数、重複、値の欠落を拒否する。環境変数・CLI とも同じ Valibot スキーマで検証し、無効な値を既定値に置き換えない。相対 `DATA_DIR` は引き続きリポジトリルート基準で、まだ作成・保存しない（#39）。CLI で開発サーバーのポートを変える場合は Vite proxy 側にも同じ `PORT` を設定する。

| URL               | 配信元 / 動作                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/health`     | `GET` / `HEAD`、JSON `{ "status": "ok" }`                                                                                                             |
| `/`、web asset    | `apps/web/dist`。`GET` / `HEAD` のみ                                                                                                                  |
| `/pyodide/*`      | `apps/web/dist/pyodide` のローカルファイル。Wasm は `application/wasm`。`/pyodide/v<x.y.z>/` 配下は `immutable` でキャッシュ可、それ以外は `no-cache` |
| `/ws`（query 可） | transport 確認用の text / binary echo。Room protocol ではない                                                                                         |

パスは source / bundle の位置から解決するので、作業ディレクトリに依存しない。別のディレクトリからも `node /absolute/path/to/discussion-room/apps/server/dist/main.mjs --port 9000` で同じ成果物を配信できる。

### Pyodide の配布物（#26）

Pyodide はブラウザーの module Worker で動き、ランタイムとパッケージはこのサーバーから配信する。実行時に CDN を参照しない。配布物はリポジトリに含めず（`.gitignore`）、次のコマンドで `apps/web/public/pyodide/v314.0.7/` に置く。Vite の dev server はそのまま配信し、`vp build` が `dist/pyodide/` へコピーする。

```sh
pnpm pyodide:fetch                                        # ランタイム + NumPy（約 16.5 MB）
pnpm pyodide:fetch --packages numpy,scipy,pandas,matplotlib  # MVP の 4 パッケージと依存（約 45 MB）
pnpm pyodide:fetch --source /path/to/pyodide-314.0.7/pyodide # 展開済みの公式リリースから（ネットワーク不要）
```

ランタイム（`pyodide.asm.wasm`、標準ライブラリーなど）は pnpm が integrity を検証した npm パッケージ `pyodide@314.0.7` からコピーする。wheel は既定で `https://cdn.jsdelivr.net/pyodide/v314.0.7/full/` から取得し、npm パッケージ同梱の `pyodide-lock.json` の sha256 と一致したものだけを置く。取得できるのは許可リスト（`numpy` / `scipy` / `pandas` / `matplotlib`）とその依存だけ。取得は一度でよく、以後はオフラインで動く。CDN に届かない環境では、公式リリースの `pyodide-314.0.7.tar.bz2` を展開して `--source` に指定する（同じ sha256 検証を通る）。判断の記録は [ADR-016](docs/decisions/016-pyodide-local-distribution.md)。

HTML の SPA fallback は `Accept: text/html` を持つ拡張子のない UI navigation に限定する。`/api`、`/ws`、`/pyodide`、`/assets` とその配下、存在しない `.js` / `.wasm` などの asset は fallback しない。dotfile、パストラバーサル、symlink ファイル・ディレクトリは配信しない。asset はストリームで送り、`HEAD` は本文を返さない。

HTTP では raw request の Host と Origin を Hono の前に検査し、WS でも `handleUpgrade` の前に同じ検査を行う。Host は `127.0.0.1` / `localhost` / `[::1]` と実際の待受ポートに限る。本番は Origin がある場合に Host と同一の HTTP origin を要求し、外部・`null` origin を拒否する。Origin のない curl や Node WS クライアントは利用できる。`Forwarded` / `X-Forwarded-*` は信用しない。

開発の source entry は Vite の別ポートから来る loopback HTTP origin も許可する。`NODE_ENV=production` なら source entry でも本番ポリシーになる。**bundle は常に本番ポリシー**。Vite の HTTP / WS proxy は Host を backend 宛てに変更するが、Origin は保持し、外部 Origin を拒否する。LAN binding・トークン認証は #45 に残る。

`SIGINT` / `SIGTERM` で新規受付を停止し、WS に code 1001 の close を送り、HTTP と WS を終了する。応答しないクライアントや未完の HTTP 接続は最大 2 秒後に切断する。終了処理は重複して実行されず、完了後にプロセスが自然終了する。起動、設定・待受エラー、終了開始・完了、HTTP / WS のエラーは timestamp / level / event を持つ JSON line で出力する。
