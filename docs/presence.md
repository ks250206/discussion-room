# Presence — 間引き、TTL、編集ソフトロック

Issue #37。設計の正は [implementation-plan.md](./implementation-plan.md) §1.1 / §1.2 と [ADR-009](./decisions/009-command-event-sync.md) / [ADR-010](./decisions/010-project-room-identity.md)。wire の形は [protocol.md](./protocol.md)。本書は非永続 Presence の送信間引き、鮮度、board 単位の編集ソフトロックを、Web とサーバーの両方から呼べる純関数にする。

#35 の seq / resume、#36 の LWW・フィールドマージ・ロールバックは実装しない。Command を解釈せず、reject も作らない。

## 利用 API

`@discussion-room/protocol` が次を公開する。状態は戻り値だけにあり、モジュールは時計も接続も保持しない。

```ts
import {
  notePresence,
  flushPresence,
  applyPresence,
  expirePresence,
  releaseClient,
  editAccess,
  PRESENCE_THROTTLE_MS,
  PRESENCE_TTL_MS,
} from "@discussion-room/protocol";

const noted = notePresence({}, { boardId, selection: [], cursor: { x: 1, y: 2 } }, now);
if (noted.ok && noted.value.kind === "hold") {
  // 呼び出し側が noted.value.dueAt で flushPresence を呼ぶ。
}
```

初期の throttle は `{}`、records は `[]`。`notePresence` / `flushPresence` は送信側、`applyPresence` / `expirePresence` / `releaseClient` / `editAccess` は受信側の状態遷移である。予想できる不正入力は `Result` の `invalid_presence` / `invalid_throttle` / `invalid_client` / `invalid_time` / `invalid_records` で、入力値はエラーに含めない。

## 送信間引き

`PRESENCE_THROTTLE_MS` は 50。issue の「目安 50ms」をこの契約の固定値にする。比較は呼び出し側が渡したミリ秒の引き算であり、日時への変換や丸めはしない。

- まだ一度も出していない snapshot は直ちに `emit` する。
- 直前の emit から 50ms 未満の更新は `hold` する。`dueAt` は最初の emit 時刻 + 50ms のままで、後続の更新で延ばさない（debounce ではない）。`held` は最新の snapshot に置き換わる。
- `dueAt` 以降の `flushPresence` がその最新 snapshot を `emit` する。早すぎる flush は `hold` のままである。
- 50ms 以降に同じ snapshot を再度 `notePresence` すると、もう一度 `emit` する。無変更を捨てると、編集を続けているだけの再送が TTL を更新できなくなる。変化と再送の区別は呼び出し側が行う。
- `emit` はロックの取得ではない。サーバーが `applyPresence` する前の送信希望である。

タイマー、`Date`、`performance.now` はこのモジュールにない。`hold` のあと dueAt で `flushPresence` を呼ぶのはクライアントの統合である。

## TTL

`PRESENCE_TTL_MS` は 10_000。計画も ADR-009 も期限の数値を持たない。テストできる契約にするため、ここで一つ決める。50ms の間引きで遅れた再送が、この窓を使い切らない長さである。

`now - receivedAt >= PRESENCE_TTL_MS` の record は不在である。等号で外れる。`receivedAt` は wire の項目ではなく、`applyPresence` に渡した `now` をサーバーが記録した時刻である。未来の `receivedAt` は期限前として残し、黙って現在時刻へ寄せない。

期限切れは cursor、selection、editingItemId をまとめて落とす。ソフトロックも同時に外れる。`expirePresence` はその判定だけを行い、いつ呼ぶかは呼び出し側である。

ロックを保つ再送間隔の定数は置かない。再送は TTL より前に届く必要があり、間引きは最大 `PRESENCE_THROTTLE_MS` 遅らせる。そのタイマーも呼び出し側の責務である。

## 編集ソフトロック

ロックの単位は `boardId` と `editingItemId` の組である。別 board の同じ id は別ロックである。一つのクライアントは snapshot を一つだけ持つので、board を移すか editingItemId を変えるか外すと、以前のロックは残らない。

| 状況 | `applyPresence` の `edit` | 保存する snapshot |
|---|---|---|
| `editingItemId` がない | `none` | 要求どおり。以前のロックは外れる |
| その組に生きている保持者がいない | `granted` | 要求どおり。このクライアントが保持者になる |
| 自分が同じ組を保持している | `refreshed` | 要求どおり。`receivedAt` は新しい `now` |
| 他の生きているクライアントが保持している | `denied` | cursor と selection は残し、`editingItemId` は付けない |

`denied` は以前の自分のロックを引き継がない。保持を続けるなら、同じ `editingItemId` を送り続ける。拒否された要求を、他者のロックと並べて保存しない。

`editAccess` がその意味を返す。

- `{ access: "edit", lock: "open" }` — 誰も保持していない。編集を始めてよいが、まだ取得していない。取得は `editingItemId` 付きの `applyPresence` が `granted` になったときだけである。
- `{ access: "edit", lock: "self" }` — この clientId が保持している。
- `{ access: "view", holderClientId }` — 他者が保持している。閲覧できる。cursor と selection の更新はできる。同じ item への `editingItemId` は `denied` になる。

presence を一度も出していない clientId でも `editAccess` は答えられる。record がないことは保持を意味しない。

item の実在、その board への所属、selection の所属は見ない。Room の状態と照合するのはサーバーである。id の形だけは domain の canonical ULID として Presence schema が拒否する。

計画 §1.1 は、テキストの衝突をこのロックで避け、位置・サイズは LWW、本文はフィールド単位のマージと分けている。どの Command フィールドを view のあいだ拒否し、どれを LWW に残すかは #36 である。このモジュールは Command を分類せず、`decide` も変えない。view のクライアントからその item の内容を変える Command を拒否する手続きは、サーバーが `editAccess` を見て行う統合である。ロックが外れたあとの競合は #36 の範囲に残る。

## サーバーが確定する識別子

`applyPresence` / `releaseClient` / `editAccess` の `clientId` は、サーバーが接続に結び付けた識別子である。C→S の presence に clientId は無く、payload へ足すと schema が拒否する。この関数は token、hello、localStorage、表示名を見ない。渡された文字列を、接続から確定済みとして使う。

これは ADR-010 の本格認証ではない。`clientId` は接続の識別であり、利用者の本人性を証明しない。照合・発行・M4 の認可はここでは行わない。

識別子は wire と同じく、trim して空でなく、200 UTF-16 code units 以下である。前後の空白や大文字小文字は正規化しない。同じ文字列は一つの record であり、後の `applyPresence` が置き換える。二つのソケットに同じ clientId を渡すと一つの snapshot に潰れる。接続ごとに分けるかどうかはサーバーが決める。

`joined.members` との照合もしない。未参加の id を拒否するのは、join 状態を持つサーバーである。records の長さが `PROTOCOL_LIMITS.maxMembers` を超える入力は `invalid_records` として拒否する。これはサイズの上限であり、参加資格の確認ではない。

## ライフサイクルは呼び出し側

このモジュールが持つのは、渡された時刻での遷移だけである。

- ソケットの close、`member` の `left`、プロセスの停止で `releaseClient` を呼ぶ。TTL を待たずにロックを外す経路はこれである。TTL は、その通知を取りこぼしたときの上限である。
- `releaseClient` は対象の record を先に除き、残りの期限切れを落とす。対象が既にいなくても成功する。残りに同じ組の生きている保持者が二人いるときは修復せず `invalid_records` を返す。
- 再送、flush、`expirePresence` のタイマーは呼び出し側が持つ。
- サーバーが配る S→C presence は、`applyPresence` が返した snapshot である。`denied` の生要求を配ると、取っていないロックが見える。
- 永続化しない。SQLite、event log、snapshot に Presence を載せない。退出した接続の Presence は復元しない。join した接続には Room 内の他のメンバーの有効な Presence を `joined` の後に配信する。クライアントは `member(action=left)` で対象メンバーの Presence を破棄する。
- 正常な遷移は二つの生きている保持者を作らない。入力が既にその状態なら、期限で片方が落ちる場合を除き、勝者を選ばず `invalid_records` にする。

`invalid_records` は clientId の重複、schema に合わない record、上限超過、生きている二重ロックである。切断処理は対象 client を除いたあとで残りの二重ロックを見るので、壊れた相手を黙って片方にしない。

送信側・受信側はそれぞれ同じ単調増加時計を使う（例: `performance.now()`）。編集中のクライアントは TTL の半分を目安に同じ snapshot を再送する。Room は申請した接続にも採用済み snapshot を返す。申請者は自分の snapshot に申請した `editingItemId` が含まれるかを見て、編集 UI を開くか判断する。
