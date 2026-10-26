# Domain エンティティ

`packages/domain` の `Project` / `Board` / `Artifact` / `ArtifactRevision` / `CanvasItem` は、それぞれ同名の `*Schema` とともに公開する。ID・日時は [共通基盤](./domain-foundations.md) の `Id` / `Timestamp` を使う。全エンティティの `version` は 1 以上の safe integer で、楽観的競合検出用。保存ファイル形式の `schemaVersion` や Revision ID とは独立し、既定値・暗黙の補完はない。

## 構造の境界

- Project: `id, title, description, createdAt, version`。description の空文字列は許可する。
- Board: `id, projectId, name, viewport, version`。viewport は `x, y, zoom`。
- Artifact: `id, projectId, kind, payload, revisionId, version`。Project スコープの実体で、Board には所属しない。
- ArtifactRevision: `id, artifactId, parentId?, payload, author, createdAt, version`。親なしを根として表し、`author` は空でない識別表記文字列。認証や人物モデルをここでは定義しない。
- CanvasItem: `id, boardId, artifactId?, x, y, width, height, viewState, version`。artifactId がない装飾カードを許可する。

title/name/kind/author は空白だけの文字列も拒否する。判定のために trim するが、保存する文字列の前後の空白は取り除かない。kind の種類と payload の判別共用体は [M1 カード payload](./card-payloads.md) の別の内容検証境界で扱うため、この構造スキーマでは種類を固定しない。座標は有限数、寸法と zoom は正の有限数。省略可能な参照はキーの不在だけを許し、明示的な undefined/null は拒否する。外側の未定義フィールドはエラーとし、未知の出自メタデータを黙って取り除かない。

`payload` と `viewState` は必須の plain object（null prototype も許可）として受け、内容・未知キー・ネストをそのまま保持する。欠損、undefined、null、配列やスカラー、Date などのインスタンスは外側の object として拒否する。ここで検証するのは構造だけで、科学的妥当性・AI 提案の承認・JSON シリアライズ可能性を保証しない。種類別 payload と科学的値の検証は [内容検証境界](./card-payloads.md#エンティティとの境界) で行い、保存・承認は後続の責務とする。この構造検証の成功を保存許可として使わない。JSON 安全性と暗黙変換の拒否は、送受信境界の #34 の受け入れ条件で追跡する。単位換算、欠損値補完、日時の正規化はしない。

現在内容の正は `Artifact.revisionId` が指す `ArtifactRevision` の著者・日時を持つ記録とし、`Artifact.payload` はその内容の現在の materialization/cache とする。#33 の Command 適用層は、種類別 payload 検証と組み合わせ、内容と参照を一体で更新して両 payload の整合を維持する責務を持つ。ここでは opaque 内容に任意の深い等値判定を定義しないため、構造・参照検証の成功は payload 内容の一致、出自、承認を証明しない。

出力のエンティティ・viewport・snapshot・配列・opaque object のキーは readonly 型とする。これはコンパイル時の浅い保護で、入力の freeze や変更、opaque 内容の複製は行わない。payload/viewState の元オブジェクトとネストの所有者も、検証後は共有された内容を変更せず、更新時は新しい値を作る規約に従う。unknown なネストの深い不変性は型でも保証しない。

## 参照と配置の境界

`validateEntitySnapshot(unknown)` は、`projects / boards / artifacts / revisions / canvasItems` の全配列を必須とするメモリ内コレクションを検証する。保存形式・WebSocket スナップショットの設計ではなく、schemaVersion も含めない。外部文書には別途完全な文書スキーマが必要となる。

構造違反は既存の `ValidationError`、参照違反は診断を持つ `EntityReferenceError` を `Result` で返す。検査対象は各コレクション内の ID 重複、参照先の存在、CanvasItem の Board と Artifact の Project 一致、現行 Revision の所有 Artifact、親 Revision の所有 Artifact、親の循環（未参照の履歴も含む）。重複がある場合は曖昧な参照を解決せず失敗する。ID と Timestamp の辞書順から因果や時系列を推論しない。複数の子 Revision による分岐を許可する。現段階では同一 Artifact の根 Revision の一意性も制約とせず、根が複数ある履歴を構造だけで統合・修復しない。

同一 Project の複数 Board から同じ Artifact を参照でき、CanvasItem がゼロになった Artifact も有効。`removeCanvasItem(snapshot, id)` は配置配列のみを作り直し、Artifact・履歴を保持する純粋関数で、存在しない配置は `Result` で失敗する。入力は検証済み snapshot とし、version の更新・Command/Event・履歴記録・永続化は後続の適用層で行う。

参照: [concept.md §7.1–7.2](./concept.md)、[implementation-plan.md §1.1 / §1.3](./implementation-plan.md)、[Valibot strictObject](https://valibot.dev/api/strictObject/)。

3 種類の線とポートの構造・参照検証は [グラフ検証](./domain-graphs.md) を参照。
