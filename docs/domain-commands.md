# ドメイン Command / Event

`packages/domain` は `CommandSchema` / `EventSchema` / `DecisionContextSchema` と readonly な `Command` / `Event` / `DecisionContext`、純粋関数 `decide` / `evolve` を公開する。根拠は [実装計画 §0・§1.1](./implementation-plan.md)、[ADR-009](./decisions/009-command-event-sync.md)。この層は IO・時計・乱数・SQLite・WebSocket・Room 配信を持たない。

```ts
const decision = decide(state, command, ctx);
if (decision.ok) {
  const nextState = decision.value.reduce(evolve, state);
  // E4 の権威側が、このイベント列を一つのトランザクションで保存する。
} else {
  // ValidationError / 参照・グラフエラー / DomainError の code と診断を扱う。
}
```

`decide(unknown, unknown, unknown)` は `Result<readonly Event[], DomainError>`。先に全入力を検査し、イベント列を作り、その全列を仮適用した最終状態を検査する。失敗ならイベントを一件も返さず、入力も変更しない。同じ入力から同じイベント列を返す。

`DomainState` / `DomainStateSchema` は既存 `GraphSnapshot` / `GraphSnapshotSchema` の別名であり、エンティティの二重定義や保存文書形式を作らない。内容の保存境界には `validateDomainState(unknown)` を使う。これは `validateGraphSnapshot` に厳密な M1 内容・現在 Revision とキャッシュの一致・全履歴の参照/出自/時系列検査を追加する。構造だけの `DomainStateSchema` を保存許可として使わない。

## Command と権威コンテキスト

各種類の Command は `type` による strict な判別共用体。下記の create は `ctx.entityId` を ID とし、version は 1 から始まる。既定値による入力項目の補完はしない。

| type の接頭辞 | create の入力 | update の入力 | delete |
|---|---|---|---|
| `project` | `value: { title, description }` | 同じ value | 可 |
| `board` | `value: { projectId, name, viewport }` | `value: { name, viewport }` | 可 |
| `artifact` | `projectId, content: { kind, payload }` | `content: { kind, payload }` | 可 |
| `canvasItem` | `value: { boardId, artifactId?, x, y, width, height, viewState }, ports` | `value: { x, y, width, height, viewState }, ports` | 可 |
| `semanticRelation` | `value: { fromArtifactId, toArtifactId, relation, rationale, metadata? }` | 同じ value | 可 |
| `dataflowEdge` | `value: { fromItemId, fromPort, toItemId, toPort, description, metadata? }` | 同じ value | 可 |
| `visualConnector` | `value: { boardId, source, target, style, description, metadata? }` | `value: { source, target, style, description, metadata? }` | 可 |

接尾辞は `.create` / `.update` / `.delete`。update と delete は `id, baseVersion` が必須。value は差分パッチではなく表にある必須項目をすべて渡す。省略可能な線の metadata は update で指定しなければ既存値を保持する。明示した metadata / ports / viewState / style は全体の置換であり、既知でない内部キーもそのまま保持する。任意フィールドへの `undefined`、未知の外側キー、欠損、暗黙の型変換は拒否する。所有 Project/Board、CanvasItem の Artifact 参照、Artifact の kind を update で移動/変更する機能は設けない。

`ports` は既存 `PortDefinition` の readonly 配列であり、create / update の両方で明示する。空のポート一覧も有効。ポートの変更が既存の DataflowEdge を壊す場合は Command 全体を拒否する。

`DecisionContext` は、クライアントから届く Command と区別した権威側の入力である。

- `commandId: Id`, `actor: string`, `timestamp: Timestamp`, `origin: "human" | "ai"` は必須。
- `entityId?: Id` は create の新規 ID。`revisionId?: Id` は Artifact create / update の新しい Revision ID。それらが必要な操作で不足していれば `invalid_context`。ID の生成、時計の読み取りは呼び出し側が一度行い、値として注入する。既存 Revision ID の再利用は `id_conflict`。
- `aiApproval?: { commandId, approvedBy }` は、権威側が確認済みの承認判断。対象 commandId と actor がそれぞれ一致しなければ `invalid_context`。

この入力形式自体は認証・利用者の実在・人の操作を証明しない。E4/M3 の呼び出し側は、クライアントから ctx を丸ごと受け入れず、検証済みの操作者・操作起源・承認から組み立てる。Command 内に `approved` や `aiApproval` を追加して承認を自称することはできない。ネットワークの envelope や Room 内認可は後続の責務。

## version と競合

更新は version を 1 増やす。safe integer を超える場合もイベントを返さない。削除、未来の `baseVersion`、および履歴を渡さない既存の 3 引数の `decide` は、現在 version と `baseVersion` の完全一致を要求する。対象が既に削除されていれば `not_found` を返し、復活させない。

### 並行更新 (#36)

Room の権威側は `decide(state, command, ctx, committedHistory)` に、同じ Room のコミット済み Event を昇順で渡す。履歴は Command やクライアントの入力から作らず、渡した state と同じトランザクション境界から取得する。対象の更新 Event を現在 version から逆にたどり、`baseVersion` に到達できなければ `version_conflict` を返す。過去の ID を再利用しない条件は引き続き必要。

- 送信された置換値を base と比較し、実際に差があるフィールドだけを編集とみなす。フィールドは各 `value`、Artifact の `content.payload` の直下、および CanvasItem の `ports`。配列や入れ子の値はひとまとまりとする。線の metadata の省略は保持、Artifact payload の任意フィールドの省略は削除を表す。
- CanvasItem の `x`、`y`、`width`、`height` の編集は各フィールドでサーバー適用順の LWW とする。送信された値が base と同じ項目は現在値を保持する。
- ほかの編集対象フィールドを base 以降に変更していれば、同じ値に戻っている場合も競合とする。それ以外は現在値へ合成し、通常のスキーマ、参照、内容、承認の検証を通す。AI 内容の古い更新は新しい差分の確認を要求するため、古い承認から合成しない。登録済みとして送られた予測は、途中に内容変更があれば拒否する。base 以降に登録された予測へ古い下書きの編集を合成すると登録時の内容が変わる場合も、競合として返す。
- ドメインの `version_conflict` は `id`、`currentVersion`、`baseVersion`、権威側の `current.entity` と CanvasItem の `current.ports`（存在する場合）を持つ。衝突したフィールドを特定できたときは `field` も返す。独立した `checkBaseVersion` は従来どおり version のみを比較する。

### 楽観表示の巻き戻し

クライアントは確定 state と確定 seq、`commandId` ごとの未確定編集を別に保持する。画面は確定 state に適用可能な未確定編集を送信順に重ねて描画する。Command は編集の根拠となった確定 version を保持し、送信済み Command の `baseVersion` をローカルで書き換えない。

1. `event` は seq 順に確定 state に適用する。複数 Event を持つ Command は、確定を示す `ack.seq` まで追いついた段階で対応する未確定編集を外す。ACK が先着しても、確定 Event が届くまで確定 state は進めない。
2. `reject` を受けたらその `commandId` の未確定編集だけを外し、確定 state と残る編集から画面を再構成する。逆 Event や過去の画面 state を現在の確定 state に適用すると、後から届いた他者の変更を消してしまう。
3. v1 の wire `reject.current` は version 診断を返す。診断の版に未到達であれば、確定 cursor 以降の Event の再送またはスナップショットを要求する。スナップショットが必要な場合も、保留中の編集は再検証し、適用できない編集を手動解決用のドラフトとして扱う。

Presence のソフトロックは #37 が定義する。Room と永続化への接続は #41、クライアント同期ストアへの組み込みは #48 が担当する。

## 著者付き Revision と内容の整合

`revisionId` が指す著者付き Revision を内容の正とする。`decide` は操作の種類によらず、初期状態の全 Artifact と現行 Revision の payload を厳密に照合する。食い違いを後続編集で修復して未記録の内容を現在の著者に帰属させず、`content_integrity_failed` で拒否する。比較は種類別に検証済みの M1 内容に対して行い、単位・オフセット・文字列を正規化せず、値を JSON 化して落とさない。

Artifact create / update は、`validateM1ArtifactContent` と所有 Artifact の kind を渡す `validateM1RevisionContent` を必須ゲートとして通す。新しい Revision の `author / createdAt` は ctx の actor / timestamp。payload の author や AI の生成時刻とは独立する。update の parentId は元の現行 Revision ID とし、元の Revision を変更せず履歴に残す。Artifact の payload / revisionId と新 Revision は一つの `artifact.changed` Event で更新する。

全履歴（現行に連ならない分岐も含む）の M1 payload、参照、親の所有と循環、編集時系列も検査する。未知・将来 kind の opaque 構造検証の成功を保存許可に使わない。M1 外の kind は、明示的な内容・参照・履歴の検証契約を追加するまで、この境界では失敗に閉じる。

### payload 内の参照

| 項目 | 検査 |
|---|---|
| hypothesis / experiment の `predictionIds` | prediction Artifact が存在し、同じ Project に属する |
| prediction の識別ルールの支持/反証 ID | hypothesis Artifact が存在し、同じ Project に属する |
| observation の `sourceIds` | source Artifact が存在し、同じ Project に属する |
| observation の `analysisCodeIds` | python Artifact が必要だが M1 にはその保存 validator がないため、現段階では非空なら拒否する |
| frame の `artifactIds` | Artifact が存在し、同じ Project に属する |
| payload の `provenance.sourceIds` | Artifact が存在し、同じ Project に属する。出典の科学的妥当性は推定しない |

参照違反は `payload_reference_failed` に `id, field, referenceId` を付ける。これらの一覧から SemanticRelation を自動生成せず、観測値から仮説 status を変更しない。参照先の削除は過去 Revision の参照も壊せない。image の `blobId`、source の外部 `reference`、SHA-256 の一致、科学量の `provenanceId` には別の資源/出自ストアが必要なので、この GraphSnapshot で存在や取得を捏造しない。各構造スキーマの検査を維持する。

### 予測の登録と時刻

新しい/変更された registered prediction は、登録時刻が新 Revision と同じ瞬間、登録主体がその Revision の actor でなければ `registration_invalid`。登録済み内容を編集するときは、新しい時刻・主体で再登録するか draft として新 Revision を保存する。元の登録内容・時刻・主体は過去 Revision に残る。同一内容をそのまま記録する場合は既存の登録を保持できる。

Revision は親をさかのぼって過去に作れず、登録は記録 Revision より未来に置けない。時刻比較は秒部分を明示オフセットで比較し、小数秒は文字列の桁をそろえて任意精度で比較する。`.0009` と `.0001` を同じ millisecond として扱わない。同一瞬間を表す異なる既知オフセット/小数桁は受け付け、元表記を保持する。`-00:00` はオフセット不明を表すため、著者付き Revision/登録の因果判定では `chronology_undetermined` にする。[Timestamp 自体の保存契約](./domain-foundations.md) は変更しない。

ここで保証するのは記録された編集・登録の時系列である。実験開始/測定の時刻は現在の payload に専用項目がなく、実験前に登録されたという物理的事実を推定したり、後から架空の時刻を埋めたりしない。

## AI 起源と承認

ctx.origin が ai の操作、または generatedBy が ai の内容保存は、上記の承認判断を必須とする。承認されない入力からはイベントを返さず、state を変更しない。

AI 起源として適用できるのは `artifact.create / artifact.update` の内容 Command に限る。それらは承認済みでも payload が `generatedBy: "ai"` と完全な AI provenance を持たなければ `ai_origin_changed` で拒否する。AI 起源を Event のヘッダーだけに残し、現在 state を human 内容として保存しない。ctx.origin が human でも、研究者が明示承認した完全な AI payload は保存でき、元の AI 起源を保持する。

AI 起源の構造操作（Project/Board/CanvasItem/線の作成・更新・削除と Artifact delete）は、承認済みでも `ai_origin_unsupported` で拒否する。現在の state にその AI 起源・モデル・生成時刻を保持する契約がなく、snapshot/ZIP 等で失われるためである。構造操作を AI 提案として適用するには、#93 以降で state と往復形式に起源を保持する明示的な契約を追加する。人が起源を自称する Command フラグによって回避できず、ctx の origin は権威側が判断する。AI 提案の保存領域・提案 UI・差分承認ワークフロー自体は実装しない。

AI 内容を編集・承認しても、generatedBy と完全な AI provenance（modelId、生成 timestamp、作成主体、手法、sourceIds を含む）を保持する。AI 親 Revision から human の子や、由来をすり替えた子を作れず、既存履歴にも同じ検査を適用する。編集者は新 Revision と Event の actor として別途残す。承認を観測や結論の正しさの証明として扱わない。

## 線・削除・再生

全操作後に既存の [グラフ検証](./domain-graphs.md) を通すため、3 種の線、Project/Board 境界、明示ポート、完全な型一致、入力ごとに 1 本、DAG を維持する。SemanticRelation の循環、VisualConnector の自己ループは各既存契約どおり許可する。

CanvasItem delete は関連する DataflowEdge / VisualConnector の削除 Event と、その配置・ポートの削除 Event を返す。Artifact / Revision / SemanticRelation は保持する。部分保存をせず一括適用する。その他の delete は暗黙に子孫を削除せず、残る参照があれば拒否する。参照されていない Artifact delete は、その全 Revision を同じ Event で取り除き、削除前の値は Event に残す。

Event の type は `project.changed / board.changed / artifact.changed / canvasItem.changed / semanticRelation.changed / dataflowEdge.changed / visualConnector.changed`。共通の `commandId, actor, timestamp, origin, aiApproval?` と、完全な `before / after`（作成前・削除後は null）を持つ。Artifact Event は完全な `revisionsBefore / revisionsAfter`、CanvasItem Event は `portsBefore / portsAfter` も持つ。これらを後続の Undo 生成に使えるが、逆 Command・Undo スタック・監査ログ永続化はこの issue では実装しない。位置の配列 index を研究内容の順序として扱わない。

`evolve(state, event) → DomainState` は権威側で検証済みの Event を順に再生する小さな reducer。EventSchema は strict なイベント構造の境界であり、単体で承認や入力 state との整合を証明しない。外部 Event を直接渡して保存許可を得る API ではない。未検証の Command には必ず decide を通し、E4 のイベントログの信頼境界から順に再生する。Event と state は readonly 共有値であり、元の opaque な内部値も呼び出し側が変更せず、新しい値で更新する。

ID の重複検査は現在 state の各コレクションと Revision に対して行う。削除済み ID の Event ログ全体をこの純粋関数は保持せず、ID の再利用を履歴越しには検出できない。E4 の ID 発行/適用境界と E7 の Undo は、削除済み ID を再利用しない永続的な方針を別途保証する必要がある。ULID の偶然の一意性をこの履歴制約の検証済み保証とは扱わない。

## Transport / 読込用の既知 M1 検査

`validateKnownM1State(unknown)` は graph 構造・参照を検証し、全ての既知 M1 Artifact に対して `validateDomainState` と同じ cache / revision 一致、payload 参照、AI 出自・provenance と事前登録の履歴遷移を検査する。未知 kind だけは opaque のまま保持する transport / 読込境界であり、未知内容の科学的検証や保存の認可を与えない。`validateDomainState` / `decide` / `evolve` の M1 保存境界は従来どおり未知 kind を拒否する。JSON 安全性は呼出し側の送受信・保存境界が別途検査する。
