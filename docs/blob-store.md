# Blob ストア (#43)

`apps/server/src/blobs/store.ts` の `createBlobStore({dataDir, repository, maxSizeBytes, authorize?})` は明示した絶対パスの DATA_DIR に `blobs/` を作る。DB は呼出し側が `openSqliteRepository(path)` で開き、Project を先に作る。通常の `main` / `createAppServer` からの自動初期化・ルート公開はしない。#41 / #42 / #45 で Project / pipeline / Host・Origin / LAN の認可境界を接続してから mount する。既存 `/api/health` 等の挙動は変更しない。

## 信頼・承認境界

`authorize({operation: "read" | "write", projectId, request})` は trusted なホストが提供する関数で、true を返した場合だけ処理する。省略・false・例外は拒否。認可前には Project の存在・hash の登録状況・ファイルにアクセスしない。登録には既存 Project、取得にはその Project に対応するメタデータが必須。他 Project に同じ hash があっても未登録 Project からは取得できない。

この関数を単に常時 true にする例はテスト fixture だけ。実際のホストは認証済み利用者の Project 操作権、保存に対する研究者の明示承認、AI proposal の採否と出自、ADR-012 の持込み・受領者・用途・Room/LAN・ZIP の範囲を上流で確認し、未実装・不明・未承認なら拒否する。HTTP header / caller の boolean / clientId は承認や法的な許諾の証明ではない。関数を提供しても、本サービスが条件や権利の真偽を認定するものではない。未承認プレビューの永続化先に使わない。将来の共有・ZIP の範囲ゲートも必要であり、この保存実装だけでは共有許可を意味しない。

## HTTP と raw byte 契約

`createBlobRouter(store)` を明示的に Hono `app.route("/api", router)` で mount すると次の二つを提供する。生の Request を使い、multipart 全体のメモリ展開やサーバーパス入力は受けない。

- `POST /api/projects/:projectId/blobs`: 本文は元ファイルそのもの。`X-Blob-Filename` は元 filename の `encodeURIComponent`、`Content-Type` は許可 MIME の完全一致。応答は `{metadata, deduplicated}`。新規は 201 / false、同じ Project/hash の再利用は 200 / true と既存の不変メタデータを返す。別名・別 MIME の再送でも新しい metadata を作らないため、クライアントは再利用 flag と実際に返された filename / MIME を表示する。
- `GET /api/projects/:projectId/blobs/:sha256`（HEAD も対応）: 小文字64桁 hash。検証済み byte 列だけを返し、Content-Type、byte 数の Content-Length、RFC 6266 / 8187 の attachment Content-Disposition（ASCII fallback と UTF-8 filename*）、nosniff、no-store を付ける。ユーザー filename をディスクパスに使わない。

filename は空・240 UTF-16 code units 超過・先頭ドット・前後空白・区切り `/` `\` `:`・C0/C1 制御文字・Unicode Cf（bidi/zero-width 等の format 文字）・不正 surrogate を拒否し、承認した元名を正規化せず保存する。最初に登録された名前と MIME は不変。同じ Project/hash を別名で再送しても新たな行・別名履歴を作らない。別 Project は独立の ID/名前/MIME を持ち、物理ファイルだけを共有する。

許可 MIME は `application/octet-stream`, `text/plain`, `text/csv`, `chemical/x-cif`, `application/json`, `image/png`, `image/jpeg`。SVG / HTML / JavaScript の MIME は未対応として拒否する。バイナリは octet-stream で明示でき、常に attachment として配信する。PNG/JPEG は先頭 signature、text/CSV/CIF/JSON は全文の fatal UTF-8 と NUL 不在を検査する。これは image decoder、CSV/CIF/JSON の形式全体や科学的内容の妥当性検証ではない。壊れた科学ファイルを補修・解析・既定値補完しない。元 byte 列（改行・BOM・空欄・十進文字列・単位・出自を含む）を一切変換しない。UTF-8 以外の原データは octet-stream として保存できる。

upload 上限 `maxSizeBytes` はホストの明示値で 1〜64 MiB。Content-Length を早期検査し、長さ宣言の有無を問わず受信 chunk の実 byte 数でも制限する。upload は逐次 hash とファイル書込みを行い、許可サイズを超えた本文全体を保持しない。download / publish 後の確認では declared size に限定した buffer を使い、通常応答を返す前にサイズと SHA-256 を検査する。download は upload 設定と独立した固定 64 MiB のメモリ上限を使い、upload 上限を下げても大きな保存済みファイルを破損扱いにしない。固定上限を超えるメタデータの取得は too_large として拒否する。同時実行数・タイムアウト・利用者ごとの quota は将来ホストの責務で、巨大ファイルに対する streaming download の検証済み完了保証は未実装。

エラーは `{error: code}` の短い応答だけ。400（入力/切断）、403（認可）、404（未登録）、413（サイズ）、415（MIME）、500（保存/破損）、503（close）を返し、内部 SQL・パス・例外本文は公開しない。

## resource registry と SQLite

`Repository.registerBlob(input)` / `readBlob(projectId, sha256)` は trusted server 内の resource registry。`blobs` テーブルの document に `{id, projectId, schemaVersion:1, storage:"content-addressed", validation:"bytes-verified", sha256, filename, mime, size}` を不変の履歴として保存する。v4 migration の Project/hash unique partial index と `BEGIN IMMEDIATE` により二つの接続でも重複登録を一行にする。登録前に Project と既存状態の整合性を検証し、未知 Project や矛盾したサイズを拒否する。`registerBlob` は `{metadata, deduplicated}` を返し、作成/再利用を同じ SQLite transaction 内で確定する。両操作は現在 Project 全体を読んで整合性を検証するため、Project サイズに比例した検査コストがある。索引による限定読出しは、この整合性契約を維持した別の最適化に残す。Repository 自体はファイルを検証しないため、`registerBlob` は本サービスが byte 検証・上流承認を通過した後に限って呼ぶ。

旧 `opaque-unverified` blob の source/payload はそのまま保持し、検証済みリソースへ自動昇格しない。`readProject().state.blobs` は両種を返す。resource 登録は共有 Graph を変えず、seq / event_log / audit_log を増やさない。未定義の DomainEvent を捏造しない。将来 Artifact が blob を参照する変更は、承認済み DomainCommand と pipeline を通して別途実装する。

resource 登録と Graph commit が並行した場合、commit 内の最新状態から不足する検証済み resource だけをマージする。古い Graph snapshot が新しい blob を削除しない。既存 resource の改変、commit 経由の新規 resource の捏造は拒否。旧 opaque 履歴を含む他の追記専用履歴は、省略・変更拒否の従来契約を維持する。#41 の snapshot 構築では `state.blobs` をそのまま引き継ぎ、DomainEvent と resource 登録通知を混同しないこと。resource 一覧の Room 配信・再接続での同期方法は後続 integration で決める。

## ファイルの公開・失敗・終了

一つの upload が所有する排他的 `.upload-<random UUID>` へ書き、fsync 後に hash だけで決まる `DATA_DIR/blobs/<sha256>` へ hard link で公開する。既存 path を上書きする rename は使わない。既存 hash のファイルも nofollow で開き、regular file / size / hash を再検査してから重複として扱う。directory の symlink / すり替え、hash path の symlink / 非 regular file、壊れた byte を拒否する。factory で canonicalize した DATA_DIR とその親は、同じ OS 利用者による悪意ある並行書換えがない trusted な保存領域として管理する。別 OS 利用者・プロセスとの完全な隔離や、全 OS の filesystem semantics は保証しない。

SQLite と filesystem は 2PC ではない。公開後の DB 失敗・切断・close・プロセスクラッシュでは未参照 hash が残り得る。一方、共有 hash を消すと並行 upload や別 Project の成功済み登録を破壊するため、失敗時に公開 hash を消さない。未参照 content は Project metadata が無い限りダウンロードできない。将来の GC は全 Project の参照と進行中 upload を調べる別設計とし、ここでは自動削除をしない。通常の abort/error では自分が作成した temporary だけを finally で削除する。cleanup の close/unlink は best effort とし、削除に失敗しても既に確定した登録成功や元の入力エラーを storage_failure に変えない。この場合も private temporary が残り得るが、hash schema / Project メタデータに対応しないためダウンロードできず、将来の回収対象とする。クラッシュ時の temporary 回収・親 directory fsync まで含む電源断耐性・backup/restore は未実装であり、cross-store の atomic rollback を主張しない。特に電源断では SQLite の確定メタデータだけが残り、hash の directory entry が失われる可能性もある。その場合も取得時に欠損を検出し、500 を返して成功・空ファイルとして扱わない。

`await store.close()` は新規操作を拒否し、pending reader を cancel して進行中処理の cleanup を待つ。冪等。認可関数はホストが必ず完了するものを提供する。close 完了後にホストが `repository.close()` する。サービスは共有 repository を勝手に close しない。

## 後続 integration と配布環境の制限

共有 Room に公開する前に、認証済み upload 実行者・時刻・理由を保持する resource 用の監査契約を #41 / #45 で定義する。現在の登録にはこれらのフィールドや監査記録がなく、Graph の event / audit を代用として増やしていない。

Cf を一律拒否するため、正当な ZWNJ / ZWJ を含む一部の言語や結合 emoji の名前も 400 になる。黙って除去・改名せず、利用者が別名を明示する必要がある。ブラウザーの `File.type` が空または許可リスト外の場合、後続クライアントは選択した形式を明示し、確認した MIME を送る。拡張子だけで科学的形式の正しさを認定しない。

DATA_DIR の filesystem は hard link をサポートする必要がある。FAT / exFAT や一部の network mount では publish が失敗する。HEAD も取得前の完全性検査を行うため、最大 64 MiB の読み込み・hash 計算コストがある。

## 検証

一時 directory / SQLite と実 loopback HTTP を使い、raw byte の完全一致、Unicode headers / HEAD、chunked 上限・切断、重複・並行した別 DB 接続、Project 間隔離、default deny、未知 Project、通常 main の未公開、空ファイル・上限一致、入力/MIME/signature/UTF-8 不正、stale Graph 保存、opaque 履歴保持、実 SQLite trigger 失敗と安全な orphan、symlink / サイズ・hash 破損 / 欠損、close / 再起動、upload 上限を下げた後の既存ファイル取得、別名/MIME の再送 flag、commit 後の unlink 失敗で成功と取得が維持されることを検査する。

API の根拠: [Hono Request / raw](https://hono.dev/docs/api/request)、[Hono router](https://hono.dev/docs/api/hono)、[Node 24 fs](https://nodejs.org/docs/latest-v24.x/api/fs.html)（exclusive open、link、nofollow、FileHandle の有限 read/write）。Hono は find-docs/Context7、Node は公式資料で確認した。
