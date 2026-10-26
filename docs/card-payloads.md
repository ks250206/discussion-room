# M1 カード payload の契約

`packages/domain` は M1 の 10 種類の `*PayloadSchema` / readonly 型と、`M1CardContentSchema` / `M1CardContent` を公開する。後者は `{ kind, payload }` の判別共用体で、kind と異なる payload を拒否する。外部入力には `validate(M1CardContentSchema, input)` を使い、入力エラーは `Result` として扱う。

## 共通項目・出自・更新日時

全 payload に `title`、`author`、`generatedBy: "human" | "ai"` が必須。タイトルと作者は空白のみを拒否し、前後の空白は変更しない。`author` はこの内容の帰属先を表す識別文字列であり、認証済みの利用者や文献の書誌的著者を表す専用モデルではない。

- `human` は `provenance` を省略できる。指定する場合は [Provenance](./scientific-quantities.md#provenance) の非 AI 出自でなければならない。
- `ai` は AI 起源の完全な `provenance` が必須。`originType: "ai"`、`generatedBy: "ai"`、モデル ID、生成時刻、作成主体、手法、出典 ID を保持する。人の承認を受けても、この出自を human に書き換えない。
- `provenance.createdBy` は生成・測定等の実行主体、payload の `author` は内容の帰属先。実験者と記録者など異なる場合があり、同一性を推定しない。

現在内容の正は `Artifact.revisionId` が指す `ArtifactRevision`。`ArtifactRevision.author` / `createdAt` はその編集を行った主体と記録日時であり、payload の帰属・AI 生成時刻と異なることがある。仮説カードの「更新日時」（concept §3.1）は現在 Revision の `createdAt` を表示する。payload に重複する `updatedAt` を持たせず、キャッシュである `Artifact.payload` 単体から更新日時を推測しない。人が AI 提案を採用する際にも revision の編集者と元の AI 出自をそれぞれ残す。

検証成功は科学的な正しさ、実測であること、AI 提案の承認、保存許可を意味しない。特に `generatedBy: "ai"` の observation は AI が生成した観測記述であり、実測を保証しない。参照先の存在・Project 所属・元データとの対応、出自の真偽、承認とリビジョンの不変性は #33 以降の適用・保存境界で検証する。

## 種類別項目

下記は共通項目に加えて必須。`?` の項目だけ省略でき、明示的な `undefined` / `null` は拒否する。

| kind | 項目 |
|---|---|
| `question` | `question`, `objectives: string[]`, `constraints: string[]` |
| `hypothesis` | `statement`, `applicability: string[]`, `refutationCriteria: string[]`, `status`, `tags: string[]`, `predictionIds: Id[]` |
| `mechanism` | `explanation`, `applicability: string[]`, `assumptions: string[]` |
| `prediction` | `applicability: string[]`, `interventionFactors: ScientificCondition[]`, `fixedFactors: ScientificCondition[]`, `expectedObservations`, `registration`, `model?: string` |
| `experiment` | `objective`, `protocol`, `controls: string[]`, `conditions: ScientificCondition[]`, `predictionIds: Id[]`, `decisionCriteria: string[]` |
| `observation` | `observations: { observable, quantity: ScientificQuantity }[]`, `measurementConditions`, `sourceIds: Id[]`, `analysisCodeIds: Id[]`, `sourceFileHash?: { algorithm: "sha256", digest }` |
| `source` | `sourceType: "paper" \| "file" \| "instrument-log" \| "web" \| "other"`, `reference`, `description` |
| `note` | `markdown` |
| `frame` | `description`, `artifactIds: Id[]` |
| `image` | `blobId: Id`, `altText`, `annotations: string[]` |

説明用の `description`、`markdown`、`altText` は空文字列も保持できる。他の文字列と文字列配列の各要素は空白のみを拒否する。配列は明示的に入力し、要素がないことを表す空配列も許可するが、期待観測量・観測値・既知の測定条件・登録済み識別ルールは 1 件以上が必要。仮説の予測は 1 件以上を推奨するが、未完成の記録を許すため `predictionIds: []` も有効。欠損した配列を空配列に補完しない。

`hypothesis.predictionIds` / `experiment.predictionIds` はカード内容に記録された参照一覧であり、科学的な関係の正である `SemanticRelation` を自動生成・置換しない。`predicts` / `tests` の関係が存在することや、その全関係を網羅することを意味しない。#33 は参照先が prediction であること・存在・同一 Project を検査し、将来 E6 で両者を連動させる場合も明示的な Command として定義する。

仮説 status は `proposed / under-test / consistent / challenged / inconclusive / superseded` のみ。`proven` は存在しない。observation は値と条件を記録し、支持／反証の解釈・仮説状態を保持しない。frame の参照はグループ内容を表し、CanvasItem の配置や所有権を変更しない。image の blob 参照、source の reference、SHA-256 の 64 桁の十六進数文字列は構造を検査するだけで、取得・実在・ハッシュ一致を保証しない。

## 予測・識別ルール

`expectedObservations` は `type: "qualitative"`（`observable, description`）または `type: "quantitative"`（`observable, quantity`）を持つ。数量は既存 ScientificQuantity を使い、不確かさと有効桁数を保持する。数値範囲・非対称区間・予測分布はこの版で新しい形式を定義せず、必要なモデルを別途設計する。`model` は明示されたモデルの記述であり、自動のモデル選択は行わない。

`registration` は次の判別共用体。draft と登録済みを区別し、どちらにも `rules` を明示する。

- `{ status: "draft", rules }`: 未登録。空の rules も許可する。
- `{ status: "registered", registeredAt: Timestamp, registeredBy, rules }`: 宣言された事前登録の日時・主体と 1 件以上の識別ルール。

各ルールは `outcome`、`supportsHypothesisIds`、`challengesHypothesisIds`、`rationale`。少なくとも一方の ID 配列に仮説が必要で、同一ルールで同じ仮説を支持と反証の両方に入れることは拒否する。これは宣言された判定基準であり、観測から自動で支持や仮説状態を更新する処理ではない。

登録時刻が実験前か、変更前の予測が残っているか、登録主体が承認したかは payload だけでは証明できない。#33 の Command 適用層は予測編集時に新しい Revision を作り、元の登録内容を残す必要がある。スキーマは登録時刻や承認を補わず、AI の登録宣言を承認の代わりにしない。

## 測定条件・科学量

`ScientificCondition` は `{ name, value }`。value は厳密な 3 種の共用体で、数量・定性条件・不明を区別する。

```ts
{ type: "quantity", quantity: { value: 10, unit: "MPa" } }
{ type: "qualitative", description: "Argon" }
{ type: "unknown", reason: "温度の記録がない" }
```

observation の `measurementConditions` は `{ status: "known", values: ScientificCondition[] }` または `{ status: "unknown", reason }`。既知の条件一覧の中でも個別の値を unknown にできる。空の既知一覧、文字列だけの `"unknown"`、単位のない数値、`null`、欠損は受け付けない。未知の温度や圧力を室温やゼロに置き換えない。

ScientificQuantity の値・単位・不確かさ・精度は既存スキーマで検証し、その表記を保持する。検証中に単位を変換せず、未知の単位を推測しない。条件名から圧力等の次元を推定する機能は持たない。異条件の比較可能性の判定もこのスキーマの責務に含めない。

## エンティティとの境界

既存の `ArtifactSchema` / `ArtifactRevisionSchema` / `validateEntitySnapshot` は [構造・参照検査](./domain-entities.md) の契約を維持する。内容を扱う境界では次を組み合わせる。

- `validateCardContent({ kind, payload })`: M1 は種類別に厳密検証する。それ以外の非空 kind は opaque plain object の構造だけを検証し、未来の内容・出自をそのまま保持する。
- `validateArtifactContent(input)`: opaque 互換の境界。Artifact の構造を検査し、kind が M1 の正確な表記の場合だけ種類別の内容を検証する。未知 kind の成功は構造検査だけを意味する。
- `validateRevisionContent(kind, input)`: opaque 互換の Revision 境界。同様に未知 kind は構造検査のみで保持する。
- `validateM1ArtifactContent(input)`: M1 専用の厳密な境界。未知 kind を拒否し、kind / payload の判別共用体を持つ `M1Artifact` を返す。
- `validateM1RevisionContent(kind, input)`: 所有 Artifact から渡された kind を M1 として厳密検証し、型付き payload を持つ `M1ArtifactRevision` を返す。kind は Revision に追加しない。過去の Revision にも適用できる。

opaque 互換 API の成功を M1 の保存ゲートとして使ってはいけない。`Hypothesis` / `hypothesis ` のような表記も未知 kind であり、opaque 互換 API では保持できるが、M1 専用 API は拒否する。kind を小文字化・trim して通す処理は行わない。未来の kind が成功しても、その科学的内容を検証済みとは扱わない。

#33 の M1 Command 適用層は `validateM1ArtifactContent` と `validateM1RevisionContent` を必須の内容ゲートに使い、所有 Artifact の kind を Revision 検証へ渡す。これに `validateEntitySnapshot` の親子・所有関係の検査、payload 内参照の検査、承認・履歴の検査を組み合わせ、現在 Revision と `Artifact.payload` を一体で更新する。現在キャッシュの一致はこれらのスキーマだけでは検証しない。opaque 互換 API は将来種別の読み取り・保持など、構造だけを扱う用途に限定する。ここでは Command 適用・永続化・承認フローを実装しない。

すべての M1 オブジェクト・ネストしたオブジェクト・配列は readonly 型。これはコンパイル時の保護であり、入力の freeze はしない。検証後の共有データを変更せず、更新には新しい値を作る。未知キーは strictObject で拒否し、AI 出自等のメタデータを黙って取り除かない。

参照: [Valibot strictObject](https://valibot.dev/api/strictObject/)、[readonly](https://valibot.dev/api/readonly/)。

#33 の適用境界は [ドメイン Command / Event](./domain-commands.md) に実装契約を記録する。登録・承認の宣言だけで適用許可を得ず、ctx と全履歴を含む検査を通す。
