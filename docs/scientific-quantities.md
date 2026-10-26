# 科学量・単位・出自の契約

`packages/domain` の公開 API。設計根拠は [concept.md §7.3 / §10.3 / §12.1](./concept.md)、共通の検証・ID・日時は [domain-foundations.md](./domain-foundations.md)。保存や AI 提案の承認処理はこの契約の外で行う。

## ScientificQuantity

外部入力は `validate(ScientificQuantitySchema, input)` で検証する。必須項目は有限の `value: number` と空でない `unit: string`。欠損、`null`、文字列の数値、`NaN`、`±Infinity` は失敗する。値がない場合は量そのものを作らず、呼び出し元のモデルで欠損理由を表す。ゼロや既定値による補完はしない。

任意項目も入力されたまま保持し、未指定なら追加しない。明示的な `undefined` は受け付けない。

| 項目 | 契約 |
|---|---|
| `uncertainty` | 有限かつ非負。値と同じ単位の絶対的な不確かさ幅。相対値や区間の両端ではない。 |
| `uncertaintyType` | `sd` / `se` / `ci95` / `instrument`。指定には `uncertainty` が必要。不確かさだけが既知の場合、型は未指定にできる。`ci95` のスカラーは対称区間の半幅として扱う。非対称区間はこのモデルの対象外。 |
| `significantFigures` | 1 以上の safe integer。数値から推定せず、丸めにも使わない。 |
| `method` | 空白のみでない文字列。表記を保持する。 |
| `provenanceId` | `IdSchema` による branded ULID。参照先の存在検査は行わない。 |

入力時には単位を正規化しない。単位の前後空白は修正せず拒否する。対応表にない単位も保存できるが、下記の変換では拒否する。未知のフィールドは失敗にするため、相対不確かさ・温度差など、解釈を変えるメタデータが黙って消えることはない。

## 明示的な単位変換

`convertQuantity(quantity, toUnit, options?)` は `Result<ScientificQuantity, UnitConversionError | ValidationError>` を返す。入力と出力を検証し、対象単位へ明示的に変換する。対応する記号・別名は次の有限の一覧に限る。大文字小文字や空白は区別し、接頭辞・組成基準・次元を推測しない。

| 次元 | 対応記号・明示的な別名 |
|---|---|
| 絶対温度 | `K`、`°C` = `degC` |
| 比 | `%` = `percent`、`1` = `fraction` |
| 長さ | `m`、`cm`、`mm`、`µm` = `μm` = `um`、`nm`、`Å` = `angstrom` |
| 導電率 | `S/m`、`S/cm`、`mS/cm` |
| 圧力 | `Pa`、`kPa`、`MPa` |
| 面積抵抗 | `Ω·m²` = `ohm*m^2`、`Ω·cm²` = `ohm*cm^2` |
| 電流密度 | `A/m²` = `A/m^2`、`A/cm²` = `A/cm^2`、`mA/cm²` = `mA/cm^2`、`µA/cm²` = `μA/cm²` = `uA/cm^2` |

- 温度のモデルは絶対温度だけを対象とし、`K < 0`、`°C < -273.15` は入力時点でも拒否する。温度差は対象外。K と °C のオフセットを伴う変換は `options: { temperatureKind: "absolute" }` の明示が必要で、指定がなければ `absolute_temperature_required` を返す。これにより、単なる `10 K` の汎用変換で絶対温度と推定して `-263.15 °C` にすることを防ぐ。呼び出し元は測定の意味を確認してから指定する。温度差を同じ記号で入力してよいという意味ではない。
- 明示した絶対温度の換算は `K = °C + 273.15`。同一の温度記号・別名（`°C` ↔ `degC`）はオフセットがないため、追加指定なしでも変換できる。変換オプションは strict に検証し、`temperatureKind: "difference"`、明示的な `temperatureKind: undefined`、未知のキーなどは `validation_failed` とする。
- `fraction = percent / 100`。百分率は濃度に限らないため、負値や 100% 超を一律に拒否しない。濃度・質量比などの用途別制約は将来そのモデルで検証する。`wt%` や `ppm` への変換は未対応。
- `1 Å = 1e-10 m`、`1 S/cm = 100 S/m`、`1 mS/cm = 0.1 S/m`、`1 MPa = 1e6 Pa`。
- `1 Ω·m² = 10000 Ω·cm²`、`1 A/cm² = 10000 A/m²`、`1 mA/cm² = 10 A/m²`、`1 µA/cm² = 0.01 A/m²`。面積抵抗と電流密度も、他の倍率と同じく 10 の整数指数で一度だけ換算する。
- `Ω` や `ohm` だけからは面積抵抗へ換算しない。面積・厚さ・電極形状の既定値は持たない。導電率（`S/m` など）と面積抵抗は別の次元であり、逆数としても換算しない。負の面積抵抗・電流密度は代数的な読みとして許す。
- `µ` は U+00B5、`μ` は U+03BC、ASCII の `u` は別名としてだけ受ける。文字は正規化しない。`Ω·m²` の中黒は U+00B7、上付きの `²` は U+00B2。`ohm*m^2` は ASCII の別名である。
- 変換先の表記を出力の `unit` にする。同じ記号・別名間の変換でも、明示呼び出しが必要。未知の単位同士が同じ文字列でも変換可能とはみなさない。
- `uncertainty` は倍率の絶対値だけを掛ける。温度の 273.15 オフセットは加えない。これは同じ不確かさ幅の単位変換であり、測定値同士の演算における誤差伝播ではない。
- `uncertaintyType`、`method`、`provenanceId` を保持し、未指定の情報は追加しない。`significantFigures` は 10 の整数乗による倍率変換と、同一記号・別名間の変換では保持する。入力と変換オプションを変更しない。
- オフセットを伴う変換では有効桁数の個数をそのまま移せない。`significantFigures` が存在すれば `precision_not_transferable` を返し、削除・再計算・新たな精度の推定はしない。明示的な絶対温度指定があってもこの制約は変わらない。
- `SUPPORTED_UNITS` は配列・各レコード・各 `symbols` 配列を実行時にも freeze し、公開された別名や換算係数を変更できないようにする。
- `unitConversionRelation(fromUnit, toUnit)` は、この同じ表から `scaleExponent` と `offset`（`y = x × 10^scaleExponent + offset`）だけを返す。絶対零度、有効桁数、絶対温度の明示、オーバーフローは検査しない。数値の変換は `convertQuantity` だけが行い、その係数計算はこの関数を呼ぶ。換算式の表示は [units-and-constants.md](./units-and-constants.md)。

例えば `25 °C`（有効桁数 2）→ K と `300 K`（有効桁数 3）→ °C は、絶対温度を明示しても `precision_not_transferable` になる。温度の原点を移すと有効桁数の意味が変わるためであり、`298.15 K` に注記 2 を引き継がない。有効桁数のない `25 °C`（不確かさ 0.2）なら、明示的な絶対温度指定により `298.15 K`（不確かさ 0.2）へ変換でき、有効桁数を追加しない。元データの精度に関する判断や表示丸めは別の明示的な処理が必要。

次元の違う組み合わせは `incompatible_units`、対応外の記号は `unsupported_unit`。計算結果のオーバーフローは `non_finite_result`、非ゼロの値・不確かさが完全にゼロへアンダーフローする場合は `numeric_underflow`。倍率は10の整数指数で保持し、指数差に応じた1回の乗算または除算で変換する。小数の倍率同士の除算による余分な丸めは避けるが、IEEE 754 の `number` を使うため通常の浮動小数点丸めは残る。例えば `298.15 K → °C` は通常の減算でも正確に 25 となる一方、`298.16 K → °C` は `25.010000000000048` となる。25.01 へ強制的に丸めない。任意精度の十進計算、全単位体系、温度差や対数尺度などは実装しない。

```ts
const parsed = validate(ScientificQuantitySchema, {
  value: 25,
  unit: "°C",
  uncertainty: 0.2,
  uncertaintyType: "instrument",
});
if (parsed.ok) {
  const converted = convertQuantity(parsed.value, "K", { temperatureKind: "absolute" });
  // 成功時: value 298.15, unit "K", uncertainty 0.2。有効桁数は未指定のまま。
  // 失敗時: converted.error.code を扱う
  const withPrecision = convertQuantity(
    { ...parsed.value, significantFigures: 2 }, "K", { temperatureKind: "absolute" },
  );
  // withPrecision は precision_not_transferable。元の記録から注記を削除していない。
}
```

## 数値の除算

`divideFinite(numerator, denominator)` は有限なスカラーだけを受け付け、`Result` を返す。`+0` と `-0` の分母は両方とも `division_by_zero`。入力の異常は `validation_failed`、結果のオーバーフロー・完全なアンダーフローは上記のエラーを返す。通常の入力エラーでは throw しない。

この関数の結果は数値だけである。量の次元・単位、有効桁数、不確かさ伝播、派生結果の出自は自動で作らない。これらを伴う科学量の演算は、用途ごとの契約と出自を指定した別の処理が必要。

## Provenance

`validate(ProvenanceSchema, input)` で検証する。必須フィールドは `id: Id`、`originType`、`sourceIds: readonly Id[]`、`createdBy`、`method`、`timestamp: Timestamp`。作者と手法は空白のみでない文字列を要求する。作者は現段階では利用者・実行主体の識別文字列であり、認証済みユーザーの存在は保証しない。日時のオフセットと小数桁を保持する。

`originType` の具体的な列挙は、設計文書に値の指定がないため、このモジュールの契約として次を定義する。

| originType | 出自 |
|---|---|
| `measurement` | 測定・観測からの値や主張 |
| `literature` | 文献から取り込んだ値や主張 |
| `calculation` | 計算・解析で得た値や主張 |
| `manual` | 研究者が入力した解釈や仮説など |
| `ai` | AI が生成した値や主張 |

AI の場合はさらに `generatedBy: "ai"` と空白のみでない `modelId` が必須で、`timestamp` は生成日時を表す。研究者が承認しても AI の起源・モデル・生成日時を保持する。承認の状態や操作者は別の処理・履歴で管理し、この出自を研究者由来に書き換えない。ここでの検証成功は保存や承認の許可を意味しない。

`sourceIds` は明示的な空配列も許可し、架空の出典は補わない。参照 ID の形式検証だけを行う。参照先が存在するか、同じ Project に属するか、出典が内容を支持するかは、実データのある層が別途検証する。未知のメタデータはこのモデルでも拒否し、失わない。

参照: [Valibot strictObject](https://valibot.dev/api/strictObject/)、[exactOptional](https://valibot.dev/api/exactOptional/)、[finite](https://valibot.dev/api/finite/)。

## 温度差と診断の補足

温度差は `K` / `°C` の絶対温度として記録しない。現在は用途を明示した未対応の記号（例: `ΔK`）として元の値を保持できるが、この変換器では変換しない。温度差の専用モデル・変換は後続の単位機能で扱う。

オフセット変換に有効桁数と明示指定の両方の問題がある場合、`precision_not_transferable` を先に返す。`originType: "ai"` に加えて `generatedBy: "ai"` を保持するのは、concept.md §10.3 の出自フィールドを承認後も失わず、カード等の共通メタデータと対応させるためである。
