# WebSocket protocol v1 — メッセージ境界

Issue #34。設計の正は implementation-plan.md §0 / §1.2 と ADR-009 / ADR-010。本書は概略を実装可能な契約に具体化する。Room 管理、トランザクション、認証、保持期間、実際の再送・競合解決・Presence TTL は実装しない。

## 利用 API

`@discussion-room/protocol` は各メッセージの Valibot schema と readonly 型、および方向別の `ClientMessageSchema` / `ClientMessage`（C→S）、`ServerMessageSchema` / `ServerMessage`（S→C）を公開する。

```ts
import { encodeClientMessage, decodeServerMessage, PROTOCOL_VERSION } from "@discussion-room/protocol";

const outgoing = encodeClientMessage({
  type: "hello", protocolVersion: PROTOCOL_VERSION, clientId: "local-client", displayName: "研究者",
});
// outgoing.ok のときだけ outgoing.value（JSON text）を transport に渡す。
// 受信した text / Uint8Array は decodeServerMessage(input) に渡し、Result を分岐する。
```

- `validateClientMessage(unknown)` / `validateServerMessage(unknown)` → `Result<Message, ProtocolError>`。
- `encodeClientMessage(unknown)` / `encodeServerMessage(unknown)` → `Result<string, ProtocolError>`。JSON 安全性 → 安全な複製 → schema / 内容検証 → JSON.stringify の順。
- `decodeClientMessage(string | Uint8Array)` / `decodeServerMessage(string | Uint8Array)` → `Result<Message, ProtocolError>`。バイト数 / 深さ等の事前検査 → JSON.parse → JSON 安全性 → schema / 内容検証の順。
- schema 単体は構造検証用。opaque な領域を含めた送受信の境界には必ず上記 API を使う。`v.readonly()` は TypeScript の契約であり、入力を凍結しない。API は入力を変更せず、opaque metadata も独立した複製として返す。

共有 package は Node / React の runtime import を持たず、TextEncoder / TextDecoder を備える browser と Node で同じ契約を使う。型検査は `src/text-codecs.d.ts` の利用箇所に限定した最小の標準 text codec 宣言を使い、DOM lib や Node globals / 型依存を追加しない。宣言自体は runtime の実装・polyfill を提供しない。

## メッセージ

全 object は strict、optional は exactOptional。省略と `undefined` は異なり、後者は JSON 安全性検査で拒否する。ID は domain の大文字 canonical ULID。`clientId`、`nonce` は非空白の文字列（200 UTF-16 code units 以下）。表示名は非空白・200 code units 以下。トークンは非空白・4,096 code units 以下で形式・有効期限・検証方式を決めない。LAN モードの token 必須化と照合はサーバーの責務。

| 方向 | type | type 以外の項目 |
|---|---|---|
| C→S | hello | `protocolVersion: 1, clientId, displayName, token?` |
| C→S | join | `projectId, lastSeq?` |
| S→C | joined | `projectId, seq, members, mode: "snapshot", snapshot: DomainState` **または** `projectId, seq, members, mode: "events", fromSeq, events: EventMessage[]` |
| C→S | command | `commandId, projectId, command: Domain Command` |
| S→C | ack | `commandId, seq` |
| S→C | reject | `commandId, code, message, current?: {version: EntityVersion}` |
| S→C | event | `projectId, seq, actor, commandId, events: Domain Event[]` |
| C→S | presence | `projectId, presence: Presence` |
| S→C | presence | `projectId, clientId, presence: Presence` |
| S→C | member | `projectId, action: "joined" | "left", member: Member` |
| 両方向 | ping / pong | `nonce`（応答で同じ値を返す契約。往復・期限の実装は呼び出し元） |

`Member = {clientId, displayName}`。同一 joined の members に clientId の重複を許さない。

`Presence = {boardId, cursor?: {x,y}, selection: Id[], editingItemId?}`。座標は有限値、selection は空でもよい。S→C の clientId はサーバーが接続から付与するため、C→S に付けると拒否する。非永続・間引き・接続断時の除去・TTL・board の実在 / selection 所属は #37 以降。構造が通ることは編集ロックの獲得や接続の認証を意味しない。

`command` は domain の `CommandSchema` をそのまま使い、M1 の content を opaque に置き換えない。概略にある envelope の `baseVersion?` は設けず、更新・削除の domain command 内の必須 `baseVersion` に一本化する。`DecisionContext`、actor、origin、aiApproval などの権威入力を command envelope に追加できない。サーバーが信頼できる経路から context を作り、domain の decide と永続化を行う。wire から AI 提案の承認権限を取得しない。`project.create` は生成前で domain command に ID がないため、envelope の projectId と比較できず、この境界では構造を受理する。Room X に参加したことを別 Project 作成の許可として扱ってはならない。サーバーが Room 内での作成を拒否するか、別途定める lobby / Project 作成経路で生成 ID と接続・認可を管理する必要がある。本 package はその経路を実装しない。

`reject.current` は競合時の **version 診断のみ**。現行 entity / state やロールバックの根拠を提供する契約ではない。#36 / #41 が必要とするなら、現行 entity / state と取得方法を別途明示的に拡張する。診断 message は非空白・2,000 code units 以下。サーバーは秘密情報を含めない責任を持つ。

## seq、snapshot、resume

`seq` は Project ごとの、コミット済み **atomic event batch** の safe integer 連番。空 Room の基準は 0、最初の event / ack は 1。1 command が複数 domain event を生む場合も一つの batch / 一つの seq。event.events は非空で、全 event の commandId / actor は envelope と一致する。ack の seq は対応するコミットの通知であり、shape が通っただけで保存済みとは判断できない。生成側がコミット後に送信することが必要。

- snapshot mode の seq は snapshot に含まれる最後のコミット。snapshot と events / fromSeq の混在は拒否する。
- events mode の fromSeq は要求した lastSeq。events は fromSeq+1 から連続し、最後が joined.seq。全 batch の projectId は joined.projectId と一致する。変更がない場合は events=[] と seq=fromSeq を明示する。
- snapshot には指定 Project がちょうど一つ必要。boards / artifacts の projectId と graph 参照を検証し、全 snapshot に domain の `validateKnownM1State` を適用する。未知の将来 kind を含む場合も、graph 参照と既知 M1 Artifact の cache / revision 一致、payload 参照、AI 出自・事前登録を含む履歴遷移の全検査を維持する。未知 payload は JSON 安全な opaque data として保持する。これは将来 kind の科学的妥当性や M1 保存可能性の認定ではない。
- event で Project を直接持つ project / board / artifact は envelope の Project に一致させ、artifact と対応 revision の既知 content も検証する。canvasItem / relation / edge 等の所属は現在の Room 状態なしに判定できない。Room が現在の状態と合わせて domain 適用・参照整合性・参加資格を検査する。

event codec の検証は Event の構造、既知 payload / revision の shape、直接分かる Project と batch identity の範囲に限る。`before` / `after` の同一 entity 対応、cache と current revision の一致、revision 履歴の AI 出自・事前登録遷移を event 単体で認定しない。受信側は現在の状態と照合して **batch 全体を原子的に適用した後**、次状態に `validateKnownM1State` を適用し、失敗した状態を採用しない。batch の途中だけを snapshot と同じ基準で認定してはならない。この受信適用層は本 package にない。サーバーは信頼できる context と `decide` / `validateDomainState` の保存境界を通し、Repository の transaction が成功した後にだけ ack / broadcast する。decode の成功や event ごとの shape 検証を、保存・AI 承認・履歴整合性の証明にしない。

#35 以降は採番と保存の原子性、lastSeq が未来のとき、イベントの保持範囲、古い lastSeq に対する snapshot fallback、サイズ上限を超える snapshot の転送方式を決める。保持日数や再送ページ分割はこの package にない。現在の v1 は一つの joined frame を上限まで受けるだけであり、大きな Room の分割転送を実装済みと扱わない。

## JSON 安全性と限界

`NaN` / ±Infinity / `-0`（符号消失）/ undefined / function / symbol / BigInt、symbol key、非 enumerable property、accessor、Date / Map 等、custom prototype、呼び出し可能な toJSON hook、疎配列、配列の追加プロパティ、循環参照を拒否する。getter / toJSON を呼ばず、descriptor からデータを複製してから schema と stringify に渡す。null prototype の安全な object と、循環しない同一 object への複数参照は許可する。`toJSON` という key 名自体は予約せず、null / 文字列 / object 等の JSON data をそのまま保持する。関数値は他の key と同じく拒否する。snapshot の出力が継承する標準 Object / Array prototype の toJSON が accessor または関数なら、descriptor を読んで呼び出さず拒否する。この限定的な検査は、一般的な prototype 改変・global の差し替えに対する防御を保証しない。数値の単位、欠損 null、AI 生成の出自、未知 metadata を補完・変換・削除しない。JSON の model は alias identity / object prototype を保存する形式ではなく、データ値を往復する。

portable JavaScript では全ての transparent Proxy を検出できない。in-process の実行可能 object を敵対的なコード隔離の境界として扱わないこと。reflection trap は実行され得るため、投げられた例外は json_unsafe にするが、trap の副作用を元に戻したり無限ループを停止したりできない。ネットワーク側は必ず decoder に text / bytes を渡す。JSON.parse が作った JSON data には getter / Proxy / custom prototype は含まれない。

JSON.parse の標準挙動として同名 key の重複は最後の値になる。JSON number は JavaScript の IEEE 754 binary64 として読み込むため、非 JS クライアントからの大きな整数や桁数の多い十進小数は丸められ、極小値は underflow で 0 になる場合がある。この decoder はその字句精度の損失を検出しない。有限な JavaScript number の送受信を対象とし、任意精度の整数・十進数や number token の元の表記を字句どおり無損失に保持するとは主張しない。正確な十進表記が必要なデータは明示的な文字列として送り、文字列はそのまま保持する（単位や意味の解釈は内容 schema の責務）。seq 等は別途 safeInteger を要求する。送信 API は重複 key を生成しない。raw text を監査原本として保持したい場合は、parse 前の text を別途保持する。受信 Uint8Array は fatal UTF-8 decode とし、不正 byte を replacement character にしない。BOM は JSON の外側の不正文字として拒否する。

## 上限

`PROTOCOL_LIMITS` は変更不可の公開定数。上限は frame 全体（opaque data 含む）に適用する。

| 上限 | 値 |
|---|---:|
| JSON UTF-8 bytes | 1,048,576（境界値を含む） |
| JSON depth（root=0） | 64 |
| value nodes（alias の各出現を別に数える） | 50,000 |
| 各 array 要素 / object own property | 10,000 |
| event.events | 1〜1,000 |
| joined.events | 0〜1,000 batches |
| members / selection | 0〜1,000 |

受信は元 text / bytes のサイズを JSON.parse 前に検査し、引用内を無視する scan で過大なネスト / token 数を先に拒否する。scan の token budget は keys / string values / containers / commas を数える上限（3×maxNodes）で、N value nodes の JSON tree は key 数が N-1 以下、string values と containers の合計が N 以下、comma 数が N-1 以下なので、送信側が受理した tree をこの事前 scan だけで拒否しない。正確な value node / collection 検査は parse 直後、schema / domain 検査より前に行う。送信は descriptor walk で escaped JSON の byte 数を加算し、上限を超えたら stringify せず終了する。入力 object の ownKeys 自体の取得や 1 frame までの parse が無コストになる保証はない。transport 側でも frame byte 上限を設定する。

## エラー

ローカル API の ProtocolError は入力値や Valibot issue dump を含めず、token や研究 payload を返さない。

| code | 意味 |
|---|---|
| json_unsafe | JSON で損失する値、実行可能 object、循環、reflection 失敗 |
| message_too_large | UTF-8 / serialized JSON byte 上限超過 |
| complexity_limit | 深さ / node / collection budget 超過 |
| invalid_json | JSON 構文エラー |
| invalid_utf8 | 受信 bytes が正しい UTF-8 でない |
| invalid_message | 方向、strict shape、内容、seq / Project 整合性が不正 |
| protocol_version_mismatch | C→S hello の整数 protocolVersion が 1 と異なる。expected / received を返す |

欠落・文字列・非整数の version は invalid_message（JSON 自体が不安全なら json_unsafe）。version negotiation は行わず、v1 で検証する。サーバーは mismatch を通常の command reject と混同せず handshake failure として扱う。切断コード / エラー送信手順は transport 実装で定める。

wire reject の `REJECT_CODES` は、domain 由来の `validation_failed`, `reference_integrity_failed`, `graph_integrity_failed`, `chronology_undetermined`, `not_found`, `version_conflict`, `id_conflict`, `invalid_context`, `content_integrity_failed`, `payload_reference_failed`, `ai_approval_required`, `ai_origin_changed`, `ai_origin_unsupported`, `registration_invalid`, `immutable_field` と、Room / pipeline 予約の `not_joined`, `project_mismatch`, `forbidden`, `rate_limited`, `internal_error`。一覧にあることは対応機能の実装完了を意味しない。
