# 3 種類の線とグラフ検証

`packages/domain` は `SemanticRelation` / `DataflowEdge` / `VisualConnector` と同名の `*Schema` を別々に公開する。設計根拠は [concept §2.4](./concept.md#24-3種類の線を分ける)、§5.4、§7.1–7.3、§17 の ADR-005（簡易版）。独立した ADR-005 ファイルはない。

全線は `id, type, createdBy, createdAt, version` を必須とする。ID・日時・楽観的 version は既存の共通スキーマに従う。説明には Semantic の `rationale`、ほかの `description` を使い、空文字列を許可する。作成者は空白だけを拒否するが trim しない。`type` は `semantic-relation` / `dataflow-edge` / `visual-connector` の固定値で、見た目から種類や科学的意味を推定しない。

| 型 | 参照と制約 |
|---|---|
| SemanticRelation | `fromArtifactId, toArtifactId, relation, rationale`。両 Artifact が存在し同一 Project に属する。Board や配置の有無に依存しない。10 種の relation を保持し、自己ループ・複数 Artifact の循環を許す。方向を逆転したり、対称関係を自動補完しない。 |
| DataflowEdge | `fromItemId, fromPort, toItemId, toPort, description`。両 CanvasItem が同一 Board に属し、名前で指定した output → input が存在する。型は完全一致のみ許可し、各入力ポートへの接続は 1 本までとする。CanvasItem を頂点とする有向 DAG に制限する。 |
| VisualConnector | `boardId, source, target, style, description`。Board が存在し、source/target の CanvasItem がともにその Board に属する。Artifact がない装飾カードや自己ループも許可し、科学的関係や実行依存を生まない。 |

## ポートの宣言と互換性

`PortDataType` は concept §5.4 の 10 種をそのまま採用する。`PortDefinition` は `name, direction: input | output, type`、`ItemPorts` は `itemId, ports`。ポート名は同一 CanvasItem 内で方向をまたいで一意とし、名前を trim しない。登録自体が存在しない CanvasItem もエラーとする。明示したポート登録は Artifact kind/payload と独立した検証用コンテキストであり、#30 の payload を解析・推定しない。今後のカード実装がポートを宣言するアダプターを提供する。

concept §5.4 の実行入力は `inputs: Record<string, PortValue>` なので、同じ `(toItemId, toPort)` を複数の線が参照する場合は先頭以外の各線に `duplicate_input_connection` を返す。後勝ちの上書きや暗黙的な集約は行わない。1 個の output から複数の入力への fan-out は許す。同じ CanvasItem 間の平行辺と diamond DAG も、到達先の入力ポートがそれぞれ異なれば許す。

`arePortTypesCompatible(output, input)` は型の完全一致のみを返す。`json` を汎用型として扱わず、number/text/table などを暗黙変換しない。型の一致は、値の単位・科学的意味・実行時 payload の正当性を保証しない。単位付き値や明示変換カードは別の検証境界で扱う。

## 検証境界

`validateGraphSnapshot(unknown)` は `Result<GraphSnapshot, ValidationError | EntityReferenceError | GraphReferenceError>` を返す。GraphSnapshot は `entities: EntitySnapshot, itemPorts, semanticRelations, dataflowEdges, visualConnectors` の全配列を必須とするメモリ上の検証用コンテキストで、保存形式ではない。

1. strict な構造検証で、不明な外側フィールド、不正な型、欠損、null、明示 undefined を拒否する。
2. `validateEntitySnapshot` で既存エンティティの参照・Project 境界・Revision 整合性を確認する。失敗時は既存のエラーをそのまま返す。
3. 各線のコレクション内の重複 ID、itemPorts の itemId 重複、同一 item のポート名重複を検出する。曖昧な宣言を選択しないよう、この段階で失敗すれば参照解決を行わない。ID の一意性は既存 EntitySnapshot と同じく各コレクション内で評価する。
4. 参照、Project/Board 境界、ポートの存在・方向・互換性・入力接続の一意性を検証する。これらを満たす DataflowEdge に対して反復 DFS で閉路を検出する。再帰を使わず O(V + E) 時間・空間で非連結部分も走査し、実際の back edge に `dataflow_cycle` を付す。入力ポートが競合しない平行辺と diamond DAG は許可する。

GraphReferenceError は `code: graph_integrity_failed, issues`。各 issue は `code, collection, id, field, reference` を保持する。`reference` は ID またはポート名。構造検証は既存の Valibot issue path を保持する。関数は入力を変更せず、期待される入力エラーを throw しない。

出自を将来拡張する場合は、全線と PortDefinition の明示的な省略可能 `metadata`、VisualConnector の必須 `style` に plain object を保持できる。これらの内容は未知キー・ネストも参照を含めてそのまま保持し、外側の未知フィールドは黙って捨てない。省略可能な metadata はキー不在のみ許し、undefined/null は拒否する。readonly は TypeScript の型境界であり、入力の freeze や深いコピーは行わない。

この検証はグラフ構造だけを保証する。metadata/style の JSON 安全性、科学的主張の正しさ、AI 提案の承認・保存許可は保証しない。これらは送受信・保存・承認の境界で検証する。

Command 適用時のポート変更と CanvasItem 削除の関連線処理は [ドメイン Command / Event](./domain-commands.md) を参照。
