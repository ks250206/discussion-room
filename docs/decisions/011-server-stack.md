# ADR-011: Hono HTTP + ws、node:sqlite、SQL と Node の開発・ビルド方式

- ステータス: 採択（技術選定と分離したスパイクで検証。本体への導入は E4）
- 日付: 2026-10-26（レビュー対応・再検証: 2026-10-27）
- 関連: GitHub issue #22（親エピック #2）、後続 #38 / #39
- 前提: [ADR-008](./008-local-server.md)、[ADR-009](./009-command-event-sync.md)、[ADR-010](./010-project-room-identity.md)

## 文脈と範囲

[implementation-plan.md](../implementation-plan.md) §0 / §1.4 に従い、Node + Hono + WebSocket + SQLite のローカルサーバーを作る。Node は既存の `.node-version` が固定する **24.22.1**、パッケージ管理は pnpm **12.15.0**、ツールは Vite+ **1.3.0** とする。設計上の待受の既定は `127.0.0.1` である。

このスパイクは `apps/server/src/spikes/server-stack/` に分離する。既存の `src/main.ts` / `app.ts`、`dev` / `build` / `start`、開発 proxy を置き換えない。単一の検証用文字列を SQLite に保存する HTTP API と WebSocket echo のみを持つ。Project / Room、Command / Event、研究データの repository、マイグレーション、blob、静的配信、LAN 公開は実装しない。M0 / M1 の完了を意味しない。

## 決定

| 対象 | 採用 | 理由 |
| --- | --- | --- |
| HTTP | `hono@4.13.14` + `@hono/node-server@2.1.5` | 計画の Hono を採用。Fetch ベースのルートを `app.request()` で待受なしにテストし、同じアプリを Node の HTTP サーバーに載せる |
| WebSocket | `ws@8.22.0` を直接使用し、`noServer: true` + HTTP `upgrade` で接続 | 既存 #18 と同じ transport。厳密な `/ws` パス判定、バイナリ保持、接続終了を明示的に扱え、現行の strict な型規約でも追加アダプターなしに検査が通る |
| SQLite | Node 組み込みの `node:sqlite` の `DatabaseSync` | 固定 Node で利用でき、追加の SQLite ネイティブパッケージ・配布物を管理せずにファイル保存できる。下記の RC 状態を受け入れる |
| ORM / query builder | **導入しない**。prepared statement とプレースホルダーを使う SQL | まず SQLite の小さな repository 境界を #39 で作る。ドメインの型・Valibot 検証と ORM スキーマを二重管理するコストを増やさず、トランザクション境界を明示する |
| 開発実行 | `node --watch src/main.ts` を継続 | erasable TypeScript と明示的な `.ts` import を Node 24 が直接実行できる。既存の watch 再起動テストを維持する |
| 本番相当のビルド | `vp pack src/main.ts --platform node` → `node dist/main.mjs` を継続 | Vite+ の tsdown による ESM 出力。依存は外部参照のまま、Node と本番依存をインストールした環境で実行する |

新たな Hono / node-server のバージョンは catalog で固定し、Valibot は既存 catalog を使う。解決結果と integrity は `pnpm-lock.yaml` に残す。`ws` は既存 catalog の範囲と lockfile の解決を維持する。Hono / node-server / Valibot は、ビルド後の `spike:start` が実行時に import するため、server の production dependencies に置く。通常の本体エントリーは今回これらを使用せず、本体への適用は #38 に残す。#38 では採用部分を本体へ移すか不採用として削除し、分離スパイク・専用 scripts・未使用の依存を整理する。恒常的な CI・依存コストとして残し続けない。

## WebSocket の比較

| 候補 | proxy・テスト・運用上の比較 | 判断 |
| --- | --- | --- |
| `@hono/node-ws@1.3.1` | Hono ルートで upgrade とイベントを扱い、Node サーバーへ `injectWebSocket` する従来方式。独立した adapter が増える。WebSocket の試験には実サーバーが必要 | Hono の[現行 Node ガイド](https://hono.dev/docs/getting-started/nodejs#websocket)はこのパッケージを非推奨とし、機能を `@hono/node-server` に統合しているため、新規導入しない。npm の deprecated メタデータは照会時に空だったので、判断の出典はガイド |
| `@hono/node-server@2.1.5` の `upgradeWebSocket` | `WebSocketServer({ noServer: true })` を `websocket.server` に渡す後継方式。同一 Hono ルートに HTTP / upgrade の前処理をまとめられる。実際に接続・echo は動作した | 今回は採らない。既存の `@types/ws@8.18.2` と `exactOptionalPropertyTypes: true` の組み合わせで、公式例の `websocket: { server: wss }` が `options.noServer: boolean \| undefined` と `boolean` の不一致で型エラーになった。Hono の WS イベント型には DOM 型も必要となった。キャストや独自の型ファサードを追加する利益は現時点では小さい |
| **Hono HTTP + 直接 `ws`** | [ws の公式例](https://github.com/websockets/ws#multiple-servers-sharing-a-single-https-server)に沿って HTTP `upgrade` でパスを判定し `handleUpgrade` する。Node 側の接続・切断テストが必要。HTTP だけなら `app.request()` でテストできる | **採用**。選定後の実コードで Vite proxy 経由の HTTP、query 付き `/ws`、text / binary echo、誤ったパスの拒否、接続中の終了を確認した |

proxy は adapter の有無そのものではなく HTTP upgrade を通す設定が必要である。既存 #18 の実際の web 設定を使う proxy テストはそのまま残し、スパイク側でも分離した Vite proxy に選定スタックを接続して試験する。後者は transport の互換性を確認するもので、既存 web 設定への置き換え試験ではない。

直接 `ws` を使う場合、Hono の HTTP middleware は upgrade を自動的には保護しない。#38 / #45 では loopback 待受でも HTTP の Host / Origin と WebSocket の Origin（`handleUpgrade` 前）を検証し、実際の Room や私的データを扱う前の要件にする。後続の #38 / Room 接続処理では、LAN の明示フラグとトークン等を **`handleUpgrade` より前**で検証する必要がある。[ws の upgrade 前処理の公式例](https://github.com/websockets/ws#client-authentication)に従い、生のソケットにはパス判定前に `error` listener を付ける。拒否時も listener を残してエラーを処理し、接続を破棄する。受入時は `handleUpgrade` に渡す直前に外し、以後のエラー処理を ws に任せる。スパイクは loopback 限定であり、LAN 公開機能を持たない。後継 adapter の型が本リポジトリの規約と整合し、HTTP / upgrade の前処理を共通化する価値が上がったら再検討する。

## SQLite ドライバの比較

| 候補 | Node 24・安定性・pnpm・配布 | 判断 |
| --- | --- | --- |
| **`node:sqlite`** | [固定した v24.22.1 の公式資料](https://github.com/nodejs/node/blob/v24.22.1/doc/api/sqlite.md)は **Stability 1.2 — Release candidate** と記載。24.15.0 で RC になっており、安定 API と断言しない。追加 npm ドライバやその install hook は不要。SQLite のバージョンは Node に従う | **採用**。検証環境の Node 24.22.1 でフラグなしに起動し、`sqlite_version()` は **3.53.4**。prepared statement、ファイルの再オープン、rollback、close を検証した |
| `better-sqlite3@13.0.3` | [公式 package.json](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/package.json)の engines は `node >=22` で Node 24 は範囲内。[公式 README](https://github.com/WiseLibs/better-sqlite3/tree/v13.0.3#installation)は主要 OS / architecture 向け prebuilt を案内し、同期 API・transaction helper を持つ。別の `.node` バイナリを配布する | 不採用。Node 組み込みで今回必要な読み書きを満たすため。ドライバ自体のインストール・動作・性能比較は行っていない |

**pnpm のビルド承認についての補足:** 確認した better-sqlite3 **13.0.3** の package.json は `prebuilds/**` を配布し、`gypfile: false`、install / postinstall script なしである。「better-sqlite3 は必ず pnpm の allowBuilds が必要」とはしない。ソースからの再ビルドには同 package の `node-gyp` スクリプトとツールチェーンが関わる。別バージョンや依存に install hook がある場合は、pnpm の [`strictDepBuilds` / `allowBuilds`](https://pnpm.io/settings/build#allowbuilds) の対象になるため、実際に採るバージョンを確認する。今回はどの native build 許可も追加しない。

`DatabaseSync` は同期 API なので、長いクエリは HTTP / WS のイベントループを塞ぐ。better-sqlite3 の通常 API も同期であり、単にドライバを変更して解消する問題ではない。今回レイテンシや同時書き込みのベンチマークは実施していない。#39 では短いトランザクション、マイグレーション・backup、必要な SQLite 設定を別に設計する。RC API の変更、必要な SQLite 機能の不足、実測した応答性の問題が出た場合に選定を見直す。重い処理の Worker 化は、その時点で別に検証する。

## ORM / query builder の比較

[Drizzle の SQLite 公式ガイド](https://orm.drizzle.team/docs/sqlite/get-started-sqlite)は `node:sqlite` と better-sqlite3 の両方を説明している。ただし照会時のガイドは `drizzle-orm@rc` / `drizzle-kit@rc` を指定し、npm `latest` は **0.45.4**、`rc` は **1.0.0-rc.5** だった。確認した 0.45.4 の exports には `./node-sqlite` がない。現行ガイドの例が latest にそのまま使えるとは扱わない。

Drizzle は型付きクエリとスキーマ・migration の管理を一緒に扱いたい場合の候補になる。今回は ORM / query builder を入れず、SQL の prepared statement を使う方針を採択する。入力と読出し行は `unknown` から Valibot で検証し、値を SQL 文字列へ連結しない。#39 では SQL とドライバを server 内の repository に閉じ込め、domain / UI へ漏らさない。SQL の量、join、スキーマ変更の負担が増えた場合は、実際の安定版と Node ドライバ対応を確認して Drizzle 等を再比較する。

JSON 検証より前に、PUT `/api/spike` へ Hono の [`bodyLimit`](https://hono.dev/docs/middleware/builtin/body-limit) を適用し、本文全体を **8 KiB** に制限する。上限超過は 413、Valibot の値の型・1024 UTF-16 code units 制限の違反は 400 とする。Content-Length と chunked の両方を検証した。8 KiB は 1024 文字すべてを JSON Unicode escape で記述しても収まるスパイク用の値であり、#38 の実データや blob の上限を決めるものではない。

## 開発・ビルドと再現手順

[Node v24.22.1 CLI 公式資料](https://github.com/nodejs/node/blob/v24.22.1/doc/api/cli.md#--watch)は、watch がエントリーと import 先を監視して再起動すると説明している。既存 `watch.test.ts` が import 先変更後の再起動を確認する。TypeScript の型検査は Node ではなく `vp check` が担う。

[`vp pack`](https://www.viteplus.dev/guide/pack)は tsdown を使う。[tsdown の依存処理](https://tsdown.dev/options/dependencies)は package.json の dependencies を既定で外部参照にする。スパイクの ESM 出力でも `node:sqlite`、`hono`、`@hono/node-server`、`valibot`、`ws` の import が残ることを確認した。ビルド成果物だけをコピーして動く単独実行ファイルにはしない。Node 24.22.1、lockfile に従ってインストールした本番依存が必要である。

リポジトリルートから以下を実行する。`vp exec node --version` で `.node-version` が解決する 24.22.1 を確認できる。親ディレクトリが存在する一時 DB のパスを指定する（省略時は `:memory:`、ファイルは作らない）。待受は `127.0.0.1`、ポートは空きポートを OS に割り当てさせ、先頭行に URL を JSON で表示する。

```sh
pnpm install --frozen-lockfile
vp run --filter ./apps/server spike:dev /tmp/discussion-room-spike.sqlite
```

表示された URL を使い、別ターミナルで次を実行する。

```sh
curl -X PUT -H 'content-type: application/json' \
  --data '{"value":"SQLite spike"}' http://127.0.0.1:<表示されたポート>/api/spike
curl http://127.0.0.1:<表示されたポート>/api/spike
```

Ctrl-C で停止し、同じ DB パスで再起動すると GET が保存済みの文字列を返す。`/ws` は text / binary echo のみ。実装済み Room と混同しないようにする。

本番相当の分離したスパイクのビルド・起動:

```sh
vp run --filter ./apps/server spike:build
vp run --filter ./apps/server spike:start /tmp/discussion-room-spike.sqlite
```

このビルドは `apps/server/dist-spike/main.mjs` を作り、通常の `dist/main.mjs` は上書きしない。実サーバー本体へ採用する作業は #38 に残す。

## 確認した結果

検証環境: macOS arm64、Node **24.22.1**、pnpm **12.15.0**、Vite+ **1.3.0**。依存は上記固定版と lockfile の解決版。

- `app.test.ts` の 8 テスト: 待受なしの Hono request、本文待機中に DB を閉じた PUT が書込み直前の再確認で 503 を返すこと、JSON 不正・型不正・余分なキー・長すぎる値の拒否と既存値維持、SQL 文字列のリテラル保存、SQLite 制約エラー時の rollback、HTTP で書込み→close→再起動後の復元、接続中 WS の終了と close の重複呼出し、Vite HTTP / WS proxy、query / text / binary、`/ws` 以外の upgrade 拒否、拒否ソケットへのエラー注入後も HTTP が利用可能なこと、Content-Length / chunked の上限超過時の 413 と既存値維持、上限内の Unicode escape 入力。
- TypeScript ソースと `vp pack` の ESM 成果物をそれぞれ独立した Node プロセスとして起動し、HTTP 書込み、WS echo、接続したまま SIGTERM（exit 0）、別プロセスで同じ DB を開いた後の復元を確認した。
- 上記の `vp run --filter ./apps/server spike:dev <一時DBパス>` と `spike:start <一時DBパス>` も実行し、表示された `databasePath` が渡したパスと一致すること、HTTP 書込み後に Ctrl-C で停止すること、同じコマンドを別プロセスで起動した後も値が復元されることを確認した。直接 Node を起動した検証とは別に、`vp run` の引数転送を確認した。
- 既存 #18 の server / watch / dev proxy テストを維持する。スパイクはローカルの検証用 DB 以外には書き込まない。
- `pnpm install` / `pnpm install --frozen-lockfile`（`vp` が解決した固定 Node 環境）、`vp check`、`vp test`（全 11 ファイル・108 テスト）、`vp build`、`vp run -r build`、スパイク用 `spike:build`、`git diff --check` が成功した。

これらは選定スタックの機能確認であり、性能、二つのブラウザの Room 同期、クラッシュ耐性、全 OS の prebuilt や配布検証、研究データの保存・復元の完了を示すものではない。
