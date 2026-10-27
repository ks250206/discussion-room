# SQLite Repository (#39)

`apps/server/src/repository/index.ts` が server 内の公開境界。ADR-011 の `node:sqlite` / `DatabaseSync`、prepared SQL を採用し、ORM は追加しない。HTTP / WS ハンドラには SQL を渡さない。`openSqliteRepository(path)` は明示された DB ファイルを開く factory であり、共有グローバル DB はない。親ディレクトリは呼出し側が管理する。サーバー起動、DATA_DIR の作成、HTTP / WS、Room、Command 適用・競合解決・broadcast への接続は後続 issue に残す。本体の main からの自動初期化は行っていない。

## 公開契約とトランザクション

- `listProjects()` は Project メタデータ一覧、`readProject(projectId)` は `{seq, state}` または `null` を返す。
- `ProjectState` は `schemaVersion: 1`、**Project をちょうど一つ含む** `GraphSnapshot`、`blobs` / `executionRecords` / `provenance` / `snapshots` の配列。配列は省略できない。行の順序は ID 順で復元するが、payload / metadata 内の配列の順序は保持する。
- `commit({projectId, expectedSeq, state, event, audit})` は Project の**完全な次状態**を受け、既存 seq の照合、状態保存、event、audit を一つの `BEGIN IMMEDIATE` トランザクションで確定する。部分パッチ API ではない。新規 Project / v1 移行直後の Project の seq は 0、最初の commit は 1。
- `event` は `{commandId, actor, createdAt, payload}`、`audit` は `{reason, payload}`。actor / reason は空白のみを認めない。payload は JSON object の構造のみの契約であり、将来の Command/Event の意味検証を置き換えない。commandId は Project 内で一意。再送の同一 commandId は二重保存を SQL 制約で拒否するが、既存 ack を返す idempotency 処理は未実装。
- event は Project ごとの連続 seq で永続化し、`eventsAfter(projectId, afterSeq)` が厳密に `seq > afterSeq` を昇順で返す。audit は `(projectId, seq)` で event に一対一に結合する。`readAudit()` は commandId / actor / timestamp / event payload の一致も確認する。
- `readProject` / `listProjects` / log 読出しも同期 read transaction に閉じ、別接続による commit の途中状態を返さない。返却値は DB と独立した object である。`close()` は冪等。
- `expectedSeq` 不一致は `conflict`。外部データ・DB 文書のスキーマ / 参照不正は `invalid_data`。将来 DB 版は `unsupported_database_version`。I/O・SQL 制約・busy / locked・closed 等は `storage_failure` として返す。保存失敗で成功を返さない。ストレージ例外は rollback し、内部エラーメッセージを Result に含めるため、その文字列を外部 API にそのまま公開しないこと。`close()` 自体の予期しないドライバ例外は呼出し側に伝播する。

future pipeline は domain.apply の結果をこの aggregate へ構成できるが、本 Repository は #33 の未マージ API には依存していない。**Project / Artifact の削除は未サポート**。Project は必須であり、歴史 Revision は保持するので、削除コマンドの完全な接続を主張しない。Project 削除時に event / audit をどう残すかは、後続で tombstone / archive 方針と共に設計する。CanvasItem とその incident graph / ports の除去は可能で、Artifact / Revision を消さない。Undo/Redo の意味判断は domain / pipeline が担当する。除去した placement の再追加を扱えるが、既存の entity は同じ version のまま内容を変更できず、変更時は必ず +1、新規 entity は version 1。歴史 Revision の書換え・除去は拒否する。

Provenance、execution record、blob メタデータ、snapshot も**追記のみの履歴**とする。既存 ID のレコードは source / payload を含む全内容を保持し、書換えと省略を拒否する。AI→manual の付替え、modelId の変更、実行履歴の脱落はできない。訂正・別実行・新しい manifest は新規 ID で明示的に追記する。実行中レコードを上書きして状態遷移させる API や履歴削除・GC は未実装であり、将来の domain 契約・監査方針と共に設計する。

## 検証と科学的制約

保存前と DB 文書読出し時に `unknown → Valibot → Result` を通す。domain の GraphSnapshot / entity 参照・Revision 所有権 / 履歴 cycle / board・project 一致 / ports・Dataflow DAG 検査に加え、既知の M1 card payload と**全歴史 Revision**、Artifact の current revision と payload cache の内容一致を検査する。SQL の索引列と JSON 文書の ID / 参照の一致も確認する。既存状態・歴史を読出し検証できない場合は上書きで修復しない。

JSON.stringify やスキーマが値を読み出す**前**に、JSON へ損失なく往復できる値に限定する。NaN / Infinity / -0、undefined、function、symbol / symbol key、bigint、Date・独自 prototype・Proxy、accessor、非列挙 property、sparse array / array extra property、循環を拒否する。`toJSON` による暗黙変換も通さない。繰返し object alias は循環ではないので受け入れる。null-prototype の plain object は受け入れる。深さ 256 を超える入れ子は拒否する。null・原文文字列・十進文字列の末尾ゼロ・単位 token・JSON 配列の順序・AI identity を保持し、単位換算や丸め、欠損の補完はしない。

将来 kind の Artifact payload は domain の方針どおり opaque object として保存し、科学的検証済みと扱わない。blob / execution / snapshot はまだ domain 契約がないため、repository 固有の最小レコードのみを使う:

```ts
// JSON object の source / payload は利用者が与えたまま。内容は未検証。
{ id, projectId, schemaVersion: 1, validation: "opaque-unverified", source, payload }
// execution は artifactId 必須、snapshot は boardId が明示されれば参照検査。
```

これはバイナリ格納、sha256 検証、実行状態遷移・再実行、snapshot manifest 検証・復元の実装ではない。推測した size / hash / runtime / 既定値を生成しない。Provenance は domain の厳密なスキーマを `{projectId, value}` で包み、AI origin / generatedBy / modelId を保持する。`sourceIds` は出典レコード等を指す拡張点であり、Artifact と勝手に同一視しない。将来 source registry の解決検証は未実装。

**Repository は承認・認可・出典の真偽や再配布権を判断しない。** `commit` を呼ぶのは trusted command pipeline が利用者の承認・AI proposal の採否・ADR-012 の持込み/共有ゲートを通した後に限る。スキーマ適合や保存成功は「AI 提案を保存してよい」「科学的に確定した」を意味しない。未承認 AI proposal のステージングストアとして呼出してはならない。author / actor 等は認証済み identity の証明ではなく、上流が与えた値である。

## DB と migration

SQLite `PRAGMA user_version` を DB 版として、文書の `schemaVersion: 1`、entity.version、event seq と区別する。version 1 は Project / Board / Artifact / Revision / Canvas / graph と port registry、version 2 は opaque metadata / provenance / event / audit、version 3 は Project スコープ検索と外部キー child 列の索引、version 4 は content-addressed blob の Project/hash unique partial index。新規 DB・v1/v2/v3 DB から v4 へ移行し、適用済み版は再適用しない。**全 pending migration と user_version の更新は一つの transaction** で行い、後半の失敗時にも前半の DDL を rollback する。`BEGIN IMMEDIATE` で write lock を取得した後に user_version を読み、他の接続が lock 待機中に移行を終えた場合も再確認する。将来版を検知した transaction も rollback して返す。新しい DB 版を古いコードで開いて downgrade しない。

外部キーを有効にし、Artifact ↔ current Revision 等の相互参照は deferred FK で commit 時に検査する。DB は STRICT tables、JSON 列は json_valid 制約を使う（JSON の意味検証は Valibot が担当）。正常起動時に file DB は WAL、synchronous=FULL、busy timeout 1000 ms。`:memory:` は SQLite の仕様上 WAL ファイルを作れないので in-memory journal のまま。WAL / SHM を手で削除せず、運用バックアップや live DB のコピー手順は別途設計する。

同期 API・Project 全体置換なので大きな Project はイベントループを塞ぐ。今回は性能や多 OS のクラッシュ耐性を保証していない。import / blob の容量上限、event retention / snapshot resume、運用 backup / recovery、Worker 化は後続で実測・設計する。

## 検証

一時 file DB で全モデルの reopen 往復、Project ごとの seq / cursor、独立接続の競合、最後の audit write 失敗 / FK 制約時の rollback、SQL-shaped 文字列、JSON 損失・既知 payload / 参照 / cache 不正、歴史不変・version、placement 除去・再追加、DB 文書破損、AI 出自・実行履歴等の書換え/脱落拒否と新規追記、v1 / v2 移行、索引の query plan、別 Worker の lock 待機中に先行接続が移行する競合、将来版拒否、migration 全体 rollback を統合テストする。

## #43 の content-addressed resource 拡張

[Blob ストアの契約](./blob-store.md)を参照。`ProjectState.blobs` は従来の opaque-unverified 履歴と検証済み byte の `StoredBlob` の union になった。`registerBlob` / `readBlob` は既存 Project の独立した resource registry であり、登録結果は `{metadata, deduplicated}` として新規/再利用を同じ transaction 内で区別する。共有 Graph / DomainEvent / seq を変えない。`commit` は並行登録された不足 resource を保持し、旧 opaque 履歴の省略・書換え拒否は変えない。新規 content resource は `commit` では登録できない。メタデータ構造検証・byte hash の検証・研究者承認・科学的妥当性・利用条件の判断を区別する。
