# 単位換算式と SI 定義定数

`packages/materials` の公開 API。数値の換算は [`packages/domain`](./scientific-quantities.md) の `convertQuantity` だけが行う。倍率とオフセットは同じ `SUPPORTED_UNITS` を読む `unitConversionRelation` から得て、ここでは算術を複製しない。

## 換算式

`convertQuantityWithFormula(quantity, toUnit, options?)` は `Result<{ quantity, conversion }, UnitConversionError | ValidationError>` を返す。

成功時の `quantity` は `convertQuantity` の結果そのものである。メタデータ、不確かさ、有効桁数の扱いは domain の契約のまま。`conversion` は次の説明であり、成功したときだけ付く。

| フィールド | 内容 |
|---|---|
| `fromUnit` / `toUnit` | 呼び出しで指定した表記。別の記号へ正規化しない |
| `scaleExponent` / `offset` | `y = x × 10^scaleExponent + offset` |
| `formula` | その式の人間可読な表記 |

`formula` の形:

- 指数もオフセットも 0 のとき（同じ記号、またはオフセットのない別名）は恒等変換として `y = x`
- オフセットが 0 のとき `y = x × 10^n`（`n` は符号つき整数。`10^0` は書かない）
- 指数が 0 のとき `y = x + a` または `y = x - a`
- 両方が非ゼロなら `y = x × 10^n + a` または `y = x × 10^n - a`

`×` は U+00D7 である。不確かさにはオフセットを足さない。式は値のアフィン写像の説明であり、結果の数値をこの文字列から再計算しない。

失敗時のコードは domain と同じである。記述子は返さない。

- `°C` / `K` のオフセットには `options: { temperatureKind: "absolute" }` が必要。未指定は `absolute_temperature_required`
- オフセット変換に `significantFigures` があると `precision_not_transferable`。桁数は消さない
- 絶対零度未満、`NaN`、`±Infinity` は変換前に拒否する
- オーバーフローは `non_finite_result`、非ゼロが完全に 0 になるアンダーフローは `numeric_underflow`
- `%` と分率は `fraction = percent / 100`。濃度の上下限は設けない
- 負の面積抵抗・電流密度は代数的な読みとして許す

面積抵抗は `1 Ω·m² = 10000 Ω·cm²`。電流密度は `1 mA/cm² = 10 A/m²`。`Ω` や `ohm` から面積を推測しない。面積・厚さ・電極形状の既定値はない。導電率は面積抵抗の逆数として換算しない。

## SI 定義定数

同梱するのは、SI を定義する正確な定数のうち次の 3 つだけである。測定値や第三者の物性表ではない（[ADR-012](./decisions/012-scientific-data-sources.md) が禁じるイオン半径・原子量・電気陰性度・酸化数の表とは別である）。気体定数 `R` とファラデー定数 `F` は派生量なので入れない。

| id | 記号 | 正確な十進 | 単位 |
|---|---|---|---|
| `elementaryCharge` | `e` | `1.602176634e-19` | `C` |
| `boltzmannConstant` | `k_B` | `1.380649e-23` | `J/K` |
| `avogadroConstant` | `N_A` | `6.02214076e23` | `mol^-1` |

各レコードは凍結され、`exact: true`、`definitionVersion: "SI 2019"`、`sourceUrl: "https://www.bipm.org/en/measurement-units/si-defining-constants"` を持つ。数値・単位・厳密性は [Defining constants](https://www.bipm.org/en/measurement-units/si-defining-constants) を出典とし、2019-05-20 発効の定義である。[SI base units](https://www.bipm.org/en/measurement-units/si-base-units) に従い、電気素量の固定値はアンペアを定義し、その値を表すクーロンは A s である。SI でのボルツマン定数の記号はしばしば `k` だが、このレコードの `symbol` は `k_B` である。

`exactDecimal` は定義の十進表記である。`value` はそれを IEEE 754 binary64 で表した機械値であり、定義そのものではない。不確かさや測定の provenance は付けない。定義定数の数値に不確かさはない、と BIPM は書いている。

`lookupSiDefiningConstant(id)` は凍結済みレコードの `Result` を返す。未知の id は `{ code: "unknown_constant", id }` であり、`undefined` や別の定数へは落とさない。記号や任意の文字列を添字にして引かない。

## 限界

- 単位系全体、接頭辞の推測、温度差、対数尺度、任意精度の十進計算はしない
- 定数の単位（`C`、`J/K`、`mol^-1`）は換算表に無く、定数同士の換算もしない
- 式は表示用の説明であり、有効桁数の付け直しや丸めの指示ではない
- `R` と `F` は `N_A`、`k_B`、`e` からこのモジュールでは計算しない
