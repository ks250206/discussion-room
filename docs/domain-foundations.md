# Domain 共通基盤

`packages/domain` は Node 組み込み・React に依存しない型、Valibot スキーマ、関数を公開する。設計の根拠は [concept.md §7.2 / §8.5](./concept.md) と [coding-conventions.md](./coding-conventions.md)。

## Result と検証

neverthrow は採用せず、readonly な判別共用体 `Result<T, E>` を採用する。`ok: true` で `value`、`ok: false` で `error` を取り出す。現段階ではメソッドチェーンや非同期 Result の要件がなく、class を使わない小さな値で十分である。

外部入力は `unknown` として `validate(schema, input)` に渡す。成功時はスキーマの **出力型**（brand や明示的な transform を含む）、失敗時は `ValidationError` を返す。失敗の `issues` は Valibot のパス、制約、入力などの診断を保持するため、入力に機密情報がある場合はログ・通信境界で必要な診断だけを選ぶ。通常の入力エラーでは throw しない。独自の変換・検証関数や ID 生成器が投げる予期しない例外は隠さない。同期スキーマのみを扱い、非同期スキーマは型で拒否する。

## ID と日時

- `IdSchema` / `Id`: 26文字の大文字 ULID。128bit を超える値・禁止文字・小文字は拒否し、自動変換しない。ID の辞書順をコマンド順序や因果順序の代わりにしない。
- `createId(generator?)`: ulid 3.0.2 の標準生成器（ブラウザ・Worker は Web Crypto、Node は crypto の条件付き実装）を使う。既定では現在時刻を読む。Math.random へのフォールバックはしない。テストでは時刻・乱数を含む生成処理全体を決定的な `() => string` として注入できる。生成器の出力も検証し、`Result<Id, ValidationError>` を返す。単調増加のための共有状態は持たない。
- `TimestampSchema` / `Timestamp`: ISO 8601 のうち `YYYY-MM-DDTHH:mm:ss[.fraction](Z|±HH:mm)` を受け付ける。4桁年（0000〜9999）、Gregorian 暦、時刻00:00:00〜23:59:59、時差00:00〜23:59。うるう秒、24:00、日付だけ、タイムゾーンのない値は対象外。実在しない日付も拒否する。文字列の時差・小数桁を保持し、Date による暗黙の補正や UTC 変換をしない。Timestamp の生成と、そのための時計の取得は呼び出し元が担当する。

時差の異なる Timestamp を文字列の辞書順で時系列に並べない。比較が必要な層で、元の精度と時差の意味を確認したうえで明示的に比較する。`-00:00` もそのまま保持し、このスキーマでは意味を付与せず、既知の UTC と黙って同一視しない。

小数秒の桁数を制限しないのは、入力で与えられた精度を保持するためである。ペイロードのバイト数上限は通信・インポート境界で検査する。黙った桁の切り捨てや、存在しない精度の補完はしない。

## schemaVersion

現行のファイル形式は `CURRENT_SCHEMA_VERSION = 1`。保存ドキュメントの完全なスキーマに `schemaVersion: SchemaVersionSchema` を **必須** フィールドとして組み込む。これは WebSocket の protocolVersion やエンティティの version とは独立する。例:

```ts
const DocumentSchema = v.object({
  schemaVersion: SchemaVersionSchema,
  id: IdSchema,
  createdAt: TimestampSchema,
});
const result = validate(DocumentSchema, input);
```

欠損・文字列の `"1"`・過去版・将来版は失敗にする。デフォルト補完や暗黙の移行はしない。将来、過去版を読む際は元の版のスキーマで検証し、明示的な移行関数を追加してから現行版として扱う。ここではドキュメントの具体的な保存形式や移行処理を先取りしない。

参照: [Valibot safeParse](https://valibot.dev/api/safeParse/)、[Valibot brand](https://valibot.dev/api/brand/)、[ulid 公式 README](https://github.com/ulid/javascript#readme)。
