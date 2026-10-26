# discussion-room

研究仮説・予測・実験計画をボード上で議論するためのローカルサーバー + ブラウザアプリ。設計は [docs/concept.md](docs/concept.md) と [docs/implementation-plan.md](docs/implementation-plan.md) を参照。

## 必要環境

- Node.js 24（`.node-version`）
- pnpm 12.15.0（`packageManager`）
- [Vite+](https://viteplus.dev/)（`vp`）

## 構成

| パス                 | 内容                                                        |
| -------------------- | ----------------------------------------------------------- |
| `apps/web`           | React + TypeScript の Web クライアント                      |
| `apps/server`        | Node のローカルサーバー（`/api/health`、開発用 `/ws` echo） |
| `packages/domain`    | ドメインの型・スキーマ・純粋関数                            |
| `packages/protocol`  | WebSocket メッセージのスキーマ                              |
| `packages/materials` | 元素・イオン半径・組成計算                                  |

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
```

## 開発サーバー

`pnpm dev` は `vp run -r --parallel dev` で、web の Vite と server を同時に起動する。`dev` スクリプトが無いパッケージは対象にならない。

| プロセス | 既定の待ち受け                         | 役割                                         |
| -------- | -------------------------------------- | -------------------------------------------- |
| web      | Vite の既定（`http://localhost:5173`） | UI。`/api` と `/ws` をサーバーへプロキシする |
| server   | `http://127.0.0.1:8787`                | `/api/health` と開発用 `/ws` echo            |

server の `dev` は `node --watch src/main.ts`。エントリから import しているソース（`src/app.ts`、`src/config.ts`）が変わると再起動する。`--watch-path` は macOS と Windows だけで Linux では使えないため付けていない。

### 環境変数

`.env.example` をリポジトリルートの `.env` にコピーする。ファイルが無くても起動でき、そのときは例と同じ既定値になる。

サーバーと Vite の開発用プロキシは、どちらも起動時にその `.env` を Node の `process.loadEnvFile` で読む（`--env-file` と同じ規則。`#` コメント、クォート、行頭の `export` が使える）。シェルに既にある変数は上書きしない。`.env.local` や `.env.development` は `PORT` / `HOST` / `DATA_DIR` には使わない。静的 build / preview では開発用プロキシを設定せず、これらの値の不備で静的ビルドを止めない。

| 変数       | 既定        | 意味                                                                                                           |
| ---------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `PORT`     | `8787`      | サーバーのポート。Vite のポートとは別                                                                          |
| `HOST`     | `127.0.0.1` | サーバーの待受アドレス。`127.0.0.1` / `::1` / `localhost` のみ許可。プロキシの接続先も同じ値。括弧は付けない   |
| `DATA_DIR` | `.data`     | リポジトリルートからの相対パス、または絶対パス。解決してログに出すだけで、ディレクトリもデータベースも作らない |

LAN 公開に必要な明示フラグと Room トークンは #45 で実装する。それまでは `0.0.0.0`、`::`、LAN アドレスなどへのバインドを拒否する。

Vite は `/api` とその配下を `http://HOST:PORT` へ、完全一致の `/ws` を `ws://HOST:PORT` へプロキシする（WebSocket は `ws: true`）。どちらもクエリ文字列を許可し、パスは書き換えない。`/apiary`、`/wsfoo`、`/ws/other` は転送しない。`HOST` が `::1` のときは URL のホストを `[::1]` にする。

`VITE_` で始まる変数だけがクライアントに露出する。`PORT` / `HOST` / `DATA_DIR` はブラウザへ出ない。Vite の `envDir` はリポジトリルート。

`.env` を変えたら `pnpm dev` を起動し直す。`.env` 自体の編集は server の watch 対象ではなく、再起動を起こさない。次のソース変更による再起動時には `.env` を読み直すが、Vite のプロキシ先は起動時の値のままになる。

`/ws` は開発用の echo で、受け取ったテキストとバイナリをそのまま返す。クエリ文字列はパスの一致から外す。サーバーを閉じる際は新規 WebSocket の受付を止め、既存接続を終了して HTTP サーバーの終了を妨げない。Room のプロトコル、Hono、SQLite はまだ入れない。
