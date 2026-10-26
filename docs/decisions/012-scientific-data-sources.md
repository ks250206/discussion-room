# ADR-012: 科学データの出典、再配布、欠損の表現

- ステータス: 採択（設計判断）。実装は未了
- 調査日: 2026-10-26
- 改訂日: 2026-10-27（科学値の契約と共有範囲をレビュー後に修正）
- 関連: GitHub issue #27（親エピック #2）
- 番号: ADR-011 は issue #22 の別 PR で追加予定。この文書は ADR-012 である
- 前提: [concept.md](../concept.md) §4.1、§4.2、§7.3、§12.4、§16。以前の計画案の「版固定データ」を、下記の同梱ゲートと利用者持ち込み方針へ改訂する

候補調査は、2026-10-26 に一次ページとリポジトリから読み取った告知とファイルの有無を記録する。2026-10-27 の改訂では IUPAC の電気陰性度の定義、CIAAW の完全表・簡約表、IUCr の permissions を再確認した。法的意見ではない。ページに書かれていない許諾を、論文の引用や、リポジトリのコードライセンスから補わない。第三者の数値表そのものは、このリポジトリへ複製しない。

## 文脈

改訂前の concept.md §4.1 は、周期表の各物性に `source / datasetVersion / unit / nullable` を付け、欠損をゼロにしない方針を示していた。§4.2 は Shannon (1976) の effective ionic radius を元素・酸化数・配位数・スピンで検索し、`ionic` と `crystal` を分け、該当条件が無い場合は `null / unavailable` を返す設計としていた。同梱予定の版固定 JSON は配布条件を事前に確認し、紙面の表をスクレイピングして埋め込まない方針だった。§11 の M0 と §15 ではその確認を未了としていた。本改訂後の §4.2 と関連項目は、この ADR の第三者物性表を同梱しない方針、Project 取込前の利用範囲ゲート、原典と欠損を保つ契約を参照する。

以前の実装計画は `packages/materials` を「純粋関数 + 版固定データ」としていた。本改訂の計画はこの ADR を参照し、第三者物性表を同梱しない。この ADR はパッケージを追加しない。数値を置ける条件だけを先に決める。

## 決定

1. **配布物にも git にも、第三者由来のイオン半径・原子量・電気陰性度・酸化数の数値表やその抜粋を置かない。** ビルド時や実行時に、IUCr、abulafia、pymatgen、prtkm/ionic-radii、CIAAW、NIST、Wikipedia からその表を取得しない。
2. **科学的な出典の指し先と、アプリが同梱する数値は分ける。** 半径の定義の参照先は Shannon (1976) である。原子量の望ましい表し方（区間、不確かさ、標準原子量を定めない印、脚注）の参照先は CIAAW の標準原子量表である。これらは定義の参照先であり、利用者ファイルの数値の実際の出典が不明なときに、その citation や URL の既定値にしない。いずれの数値も、この決定では同梱しない。
3. **同梱の代替は、利用範囲を確認できた利用者持ち込みデータの Project インポートとする。** Room = Project であり、Project 内のデータは通常の snapshot / event / ZIP の対象となる。第三者表を Project に確定する前に、その共有・保存・出力範囲に必要な条件を確認するゲートを要する。引用や許諾 URL の欠損は科学レコードの形式検証だけでは拒否理由にしないが、利用条件を特定できなければ Project へのインポートは拒否する。ゲートが未実装の間は Project インポートを提供しない。この判断は再配布を許諾したり、アプリが法的な権利を認定したりするものではない（下記「共有・エクスポート」）。
4. **欠損は `null` と理由である。** ゼロ、空配列、NaN、隣接する配位数、別の酸化数、別のスピン、もう一方の半径定義、区間の中点、最長寿命核種の質量数で埋めない。ある定義の半径から、定数を足し引きして別の定義を作らない。
5. **後から第三者由来の数値表・抜粋を同梱できるのは、次をすべて満たす新しい ADR のあとだけである。**
   - データセット自体を複製・改変・再配布してよいと、そのデータセットのライセンスファイルまたは権利者のページが書いている。周囲のコードのライセンスだけでは足りない。
   - 採用するリリースまたはコミットと、ライセンスファイルの URL を固定する。
   - 区間、不確かさ、標準原子量が無い印、イオン半径と結晶半径の欠測が、変換後も残る。
   - 電気陰性度は尺度ごとに分かれ、酸化数は出典が付ける分類（代表値か、報告された集合か）を保つ。

## 確認した候補

確認日は 2026-10-26。コミットは、その日に GitHub のタグまたは既定ブランチから読んだものである。

### イオン半径

| 候補 | 固定した位置 | ページ上のライセンス | この ADR での扱い |
| --- | --- | --- | --- |
| Shannon 1976 | DOI [10.1107/S0567739476001551](https://doi.org/10.1107/S0567739476001551)。書誌頁 [journals.iucr.org/paper?S0567739476001551=](https://journals.iucr.org/paper?S0567739476001551=)。Acta Cryst. A **32**, 751–767。出版社は IUCr。Crossref の license URL は [copyrightpolicy.html](https://journals.iucr.org/services/copyrightpolicy.html) である | 方針頁は、読者が図や表を改変せず自分の出版物へ転載する場合を、出典の明示つきで許可する、と書く。それ以外は permissions と terms of use へ回している。[permissions.html](https://journals.iucr.org/services/permissions.html) は、事前許可なしの転載を、学術雑誌・書籍・学位論文等への掲載に限る、と書く。系統的な再掲は IUCr のライセンスが要る、と書く。書誌頁に CC 表示は無く、本文 URL <https://journals.iucr.org/a/issues/1976/05/00/a12967/> は 401 だった。補遺の科学データファイル（CIF 等）についての一文は、論文中の表とは別に書かれている | 定義の参照先にする。表は同梱しない。スクレイピングしない |
| pymatgen-core `v2026.10.16` | タグはコミット [`cddebfb21ed5acaee3987948b6704a2790d4e056`](https://github.com/materialsproject/pymatgen-core/commit/cddebfb21ed5acaee3987948b6704a2790d4e056)。コードのライセンスファイルは [LICENSE](https://github.com/materialsproject/pymatgen-core/blob/v2026.10.16/LICENSE)（MIT。著作権表示は 2011–2012 MIT および The Regents of the University of California, through Lawrence Berkeley National Laboratory） | MIT の許諾文は "this software and associated documentation files (the Software)" に対するものである。`Shannon_Radii.csv`（blob `aa9120315b73ebae615062dd11d34d98c6f76820`）の先頭は列名だけで、ライセンス行も引用行も無い。生成スクリプト `parse_shannon_radii` は `TODO: data source/reference is unknown` と書き、呼び出しは `unit="ang"` だけで reference を渡さない。生成物 `periodic_table.json.gz`（blob `7bab9e8be36d22e04d5fb1c526a365bce84bdcd0`）にも別の許諾ファイルは無い | コードの MIT を、Shannon 表の再許諾とは扱わない。CSV も JSON も同梱しない |
| pymatgen `v2026.10.24` | コミット [`e3fdb6d4bb2a3bc1622f4c133e088d660f0c3c26`](https://github.com/materialsproject/pymatgen/commit/e3fdb6d4bb2a3bc1622f4c133e088d660f0c3c26)。[LICENSE](https://github.com/materialsproject/pymatgen/blob/v2026.10.24/LICENSE) は core と同じ MIT 文 | 元素データの実体は pymatgen-core 側にある。メタパッケージの LICENSE はデータセットの独立した許諾ではない | 同梱の根拠にしない |
| prtkm/ionic-radii | 既定ブランチ `master`、先頭コミット [`228bd51d76ac1ae9a16f17aca574b7af407c541e`](https://github.com/prtkm/ionic-radii/commit/228bd51d76ac1ae9a16f17aca574b7af407c541e)（2014-07-16）。ルートは `readme.org`、`compile.org`、`shannon-radii.json`。LICENSE ファイルは無く、GitHub の license フィールドは null | `readme.org` は、データを `http://abulafia.mt.ic.ac.uk/shannon/ptable.php` から得たと書く。その URL は同日 HTTP 200 で、表示名は "Shannon Radii" / "Database of Ionic Radii"、末尾は Imperial College の Atomistic Simulation Group によるホスト、と読めた。ライセンス文は、数値行を除いたテキストには無かった | 同梱しない。readme が示すキー名（`r_crystal`、`r_ionic`、`spin`、`remark`）は、下のスキーマが備える区別の実例に使う。数値は複製しない |
| Van Horn の電子表 | <https://v.web.umkc.edu/vanhornj/shannonradii.htm> | 同日の応答は HTTP 500 で、本文を確認できない | 許諾の根拠にしない |

pymatgen-core の同じタグには、Shannon 表とは別の半径ファイルがある。`ionic_radii.csv` は酸化数ごとの単一値で、配位数・スピン・結晶半径を持たない。生成スクリプトはその reference を `https://en.wikipedia.org/wiki/Ionic_radius`（確認した版は revid `1374374808`、2026-09-11）としている。`radii.csv` は原子半径、計算原子半径、ファンデルワールス半径、金属半径であり、生成スクリプトの reference 文字列は `https://wikipedia.org/wiki/Atomic_radii_of_the_elements_(data_page)` である。concept.md §4.1 の「定義の異なる原子半径を混在させない」に合わせ、これらをイオン半径の穴埋めに使わない。

`Species.get_shannon_radius`（`periodic_table.py`、同タグ）は、スピンのデータが一つだけのとき、要求したスピンと違っていてもその値を返す、と docstring と警告文に書いている。`ionic_radius` は、既定値が無いとき high-spin、次に low-spin を使う。`Element.X` は Pauling 電気陰性度が無いとき NaN を返す。`min_oxidation_state` と `max_oxidation_state` は、酸化数のキーが無いとき `0` を返す。これらの振る舞いは採用しない。

### 原子量

| 候補 | 固定した位置 | ページ上のライセンスと表し方 | この ADR での扱い |
| --- | --- | --- | --- |
| CIAAW 標準原子量 2024 | [atomic-weights.htm](https://www.ciaaw.org/atomic-weights.htm)。本文は、2021 年報告に Gd、Lu、Zr の 2024 年改訂を加えた表だと書く | [impressum.htm](https://www.ciaaw.org/impressum.htm) は、CIAAW と IUPAC の共同著作権、教育目的での自由利用、© CIAAW, 2007–2022、出典・©・名称・出版年を明示すれば正式許可なしに再掲・電子的な保管と頒布ができる、と書く。商用は CIAAW Secretariat へ連絡、と書く。告知の年の範囲は 2022 年までで、表の見出しは 2024 である。どちらが 2024 年の数値を覆うかは、この文書では決めない | 区間、括弧つき不確かさ、標準原子量を定めない印、脚注 g / m / r をスキーマが失わないための参照先。数値表は同梱しない |
| IUPAC Technical Report 2021 | DOI [10.1515/pac-2019-0603](https://doi.org/10.1515/pac-2019-0603)。Pure Appl. Chem. **94**, 573–600。出版社は Walter de Gruyter GmbH。Crossref の license URL は [CC BY-NC-ND 4.0](http://creativecommons.org/licenses/by-nc-nd/4.0) | 出版社 HTML はこの確認では 406 だった。Crossref の license フィールドと、同じ DOI の PDF に印字された行は [CC BY-NC-ND 4.0](http://creativecommons.org/licenses/by-nc-nd/4.0) を指す。この識別子を、報告の表を JSON へ改変して同梱する許諾としては採用しない | 報告の JSON 化や同梱はしない |
| CIAAW 簡約表 | [abridged-atomic-weights.htm](https://www.ciaaw.org/abridged-atomic-weights.htm)。応答の `Last-Modified` は 2024-10-23。本文は、完全な表は詳細が多いため簡約値を示す、と書く | サイトの告知は impressum と同一 | 完全な表の代わりに採用しない。簡約値を読む実装を後で足す場合も、別の `datasetId` と表種別で区別し、版は各原典の宣言のまま保つ。完全な表が持つ区間を簡約値から復元しない |
| NIST SP 966 周期表 Version 15 | [periodic-table-elements](https://www.nist.gov/pml/periodic-table-elements)。June 2024。旧称 SRD 145 を、情報編纂物へ再分類した、と頁は書く。版履歴は [periodic-table-version-history](https://www.nist.gov/pml/periodic-table-version-history) | [open/license](https://www.nist.gov/open/license) は、SRD と、SRD ではない NIST 職員の著作物を分けて書く。SRD は [srd/public-law](https://www.nist.gov/srd/public-law) が、事前許可のない複製を拒む、と書く。周期表の頁自体は、非 SRD の派生物許諾文を転載していない。版履歴は、Ar の簡約標準原子量を ciaaw.org に合わせて更新したこと、一部元素では最長寿命核種の質量数を使うこと、アスタリスクは区間で表される標準原子量の IUPAC 慣用値であること、を書く | 原子量データセットに採用しない。ポスター上の単一値や質量数を、CIAAW の区間や欠測の代替にしない |
| NIST Atomic Weights and Isotopic Compositions | [製品頁](https://www.nist.gov/pml/atomic-weights-and-isotopic-compositions-relative-atomic-masses)。Online September 1999、最終更新 January 2015。原子量は Meija ら 2013、同位体組成は Berglund と Wieser 2009、相対原子質量は AME2012 から編纂し、NIST PML の臨界評価ではない、と頁は書く。data.gov のメタデータはライセンス URL を NIST の open license とし、DOI [10.18434/T4KG6Q](https://doi.org/10.18434/T4KG6Q) を示す | 製品頁は、編纂元の IUPAC / AME の表を再許諾したとは書いていない。DOI は確認時に別 URL へリダイレクトした | 2013 年の編纂であり、2024 年の CIAAW 表の代わりに採用しない |

pymatgen-core `v2026.10.16` の `elemental_properties.yaml` は、`Atomic mass` の reference を `https://en.wikipedia.org/wiki/List_of_elements_by_atomic_properties`（確認した版は revid `1305927032`、2025-08-14）、unit を `amu` としている。値は元素ごとに一つの数で、区間フィールドは無い。Wikipedia のテキストライセンスは下に記す。この YAML の原子量は同梱しない。`amu` という単位ラベルを、CIAAW の標準原子量へ黙って付け替えない。

### 電気陰性度

pymatgen-core の同じ YAML で、プロパティ名 `X` の reference は `https://en.wikipedia.org/wiki/Electronegativities_of_the_elements_(data_page)` である。確認した版は revid `1365095191`（2026-07-20）。節は Pauling scale、Allen scale、ReVEBE scale に分かれている。`Element.X` の docstring は Pauling 電気陰性度と書き、欠測を NaN にする。

[IUPAC Gold Book E01990](https://goldbook.iupac.org/terms/view/E01990) は、Mulliken の定義をイオン化エネルギーと電子親和力の平均、Pauling の相対尺度を無次元として区別する。Mulliken のエネルギー値を無条件に無次元の `1` にしない。Allen の分光学的定義もエネルギーに基づく（[原論文](https://doi.org/10.1021/ja00207a003)）。資料のエネルギー単位表現と相対尺度へ規格化した表現を混同せず、入力が宣言する単位と規格化の約束を保持する。これらの定義の参照は、数値表の再配布許諾を意味しない。

NIST SP 966 の data.gov キーワード（原子番号、原子量、基底配置、基底準位、イオン化エネルギー）に、電気陰性度は含まれていない。尺度の違う値を一つの列にまとめず、Pauling が無い箇所を Allen や別尺度で埋めない。数値表は同梱しない。

### 酸化数

同じタグの `oxidation_states.yaml`（blob `52d165cb308e6a446b735fcf11da0aedc21a0035`）は、reference を `https://en.wikipedia.org/wiki/Template:List_of_oxidation_states_of_the_elements` とし、その reference が「主な酸化数」なのか「あり得る酸化数」なのかを疑う TODO コメントをファイル内に持つ。`elemental_properties.yaml` の `Common oxidation states` も同じ URL を reference にする。確認したテンプレートの版は revid `1340524841`（2026-02-26）。

代表的酸化数と、報告された酸化数の集合は、別の `classification` で持つ。出典がどちらとも印を付けていないファイルは、読み込み時に拒否する。推測で太字だけを代表値にしない。配列が無いことは `null` と理由であり、空配列でも `0` でもない。組成計算の形式酸化数（concept.md §4.3）は利用者の仮定であり、この表の検索結果ではない。

IUPAC が、ソフトウェア同梱を許すと書かれた機械可読の「代表的酸化数」表を公開している、という確認はこの調査では取れていない。

### Wikipedia のテキスト

[Wikipedia:Copyrights](https://en.wikipedia.org/wiki/Wikipedia:Copyrights) は、記事テキストの再利用が、著者によるオープンライセンスの条件に従う限り許されている、と書く。ライセンスとして [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) と、別段の注記が無い場合の GFDL（バージョン指定なし、不変部分なし）を挙げる。ウィキメディア財団は記事テキストの権利者ではなく、許諾を出せない、とも書く。

このライセンスは Wikipedia のテキストに対するものである。上の各頁は、区間を保つ原子量、尺度を分けた臨界評価、分類が確定した酸化数、のいずれの採用条件も満たさない。CC BY-SA の継承を、このリポジトリの同梱データに対して引き受ける決定もしない。確認時点で、このリポジトリのルートに LICENSE ファイルは無い。

## スキーマ

これは E9 の実装用の契約案であり、まだ型やインポータを実装したものではない。**正常に読み込める行の型と、検索時の取得不能を分ける。** 必須の科学的条件が無い行は検証失敗として受け入れず、欠けた条件を持つ「正常な行」を生成しない。

### 出典と共通の欠損

数値の単位はファイル、または利用者が明示して付けたインポート定義から得る。単位・尺度・分類をアプリの既定値で補わない。保存する十進文字列は元の桁と末尾ゼロを保ち、計算用の浮動小数で上書きしない。区切り・括弧・空白などを含む元の印字表現がある場合は、下記 `printed` にもそのまま残す。宣言した形式で有限な十進数と解釈できない入力は拒否し、NaN や Infinity は保存しない。

```ts
type MissingMetadataReason = "not-supplied" | "unknown";

type DataSource = {
  sourceId: string;
  citation: string | null;
  citationUnavailableReason: MissingMetadataReason | null;
  url: string | null;
  urlUnavailableReason: MissingMetadataReason | null;
  licenseUrl: string | null;
  licenseUrlUnavailableReason: MissingMetadataReason | null;
};

type DatasetPin = {
  datasetId: string;
  source: DataSource;
  datasetVersion: string | null;
  versionUnavailableReason: MissingMetadataReason | null;
};

type DatasetSelection = { sourceId: string; datasetId: string };

type Lookup<T, R extends string> =
  | { status: "found"; record: T }
  | { status: "unavailable"; record: null; reason: R };

type DatasetUnavailableReason = "no-dataset" | "not-in-source";
type PropertyRecords<T> = Lookup<[T, ...T[]], DatasetUnavailableReason>;
```

値があるメタデータの理由は `null`、値が `null` なら理由は必須である。`not-supplied` は入力に無い、`unknown` は入力が不明と明示した場合である。`source` 自体は読み込んだレコードに必須だが、中の引用・URL・許諾 URL がすべて不明でもよい。Shannon (1976) などの定義文献を、そのファイル内の数値の実際の出典として補わない。利用者が明示した引用や URL を保持することと、アプリがその帰属や許諾を確認したことも区別する。

`sourceId` と `datasetId` はインポート時に登録する識別子で、実装では共通基盤の `Id` 形式を用い、ZIP 往復でも保持する。`sourceId` は出典メタデータの登録を、`datasetId` は取り込んだデータセットを区別するためのもので、帰属や権利を証明する ID ではない。引用や版がどちらも `null` でも、別データを同一視しない。

`datasetVersion` は入力が宣言した版であり、`latest` やアプリのビルド日で補わない。版が入力に無ければ理由つき `null` を許す。検索は `DatasetSelection` でデータセットと登録出典を明示する。必須選択肢の欠損・不正値や、登録済みの dataset と source の対応不一致は検証失敗であり、取得不能と混ぜない。正常な検索では、選んだデータセットが未読込なら（別データがあっても）`no-dataset`、その中に対象元素・条件が無ければ `not-in-source` とする。

同梱データが無い初期状態は、空の架空レコードを作らず `Lookup` の `no-dataset` を返す。取得不能の型は `record: null` と理由で表し、正常な配列へ空配列を入れて代用しない。

ここでの十進文字列・原単位・`printed` は原典の記録であり、concept.md §7.3 の計算用 `ScientificQuantity`（`value: number`）を置き換えない。計算用の有限な数値ビューを作る場合は明示的に読み替え、元レコードと出自を保持し、丸め・オーバーフロー等を扱う。下記 `RadiusValue` の原単位契約は `pm` / `Å` に限定するため、`angstrom` / `ang` の原典は現契約では受け付けない。後で別名入力に対応する場合も、元トークンを保持できる原典形式を残し、出自・対応表・変換の記録を伴う明示的な計算用ビューとして扱う。原典の単位を `Å` へ黙って正規化しない。

### イオン半径の読み込み行と検索

issue #27 のフィールド名を維持する。半径の**保存単位は元データの宣言のまま** `pm` または `Å`（U+00C5）。見た目の似た `Å`（U+212B）はこの契約では未対応として拒否し、Unicode 正規化で黙って置き換えない。原単位が無いファイルや未対応の単位は拒否し、値だけから推測しない。保存時の pm→Å 換算は行わない。表示時に明示的に換算する場合だけ、原値・原単位と表示値・表示単位、換算式（`pm / 100 = Å`）を併記し、元レコードは書き換えない。

```ts
type RadiusValue = { decimal: string; unit: "pm" | "Å" };

type ShannonRadiusRecord = DatasetPin & {
  element: string;
  oxidationState: number;
  coordination: string;
  spin: "high" | "low" | null;
  spinPrinted: string;
  spinUnavailableReason: "not-specified-in-source" | null;
  ionicRadius: RadiusValue | null;
  ionicRadiusUnavailableReason: "radius-type-absent" | null;
  crystalRadius: RadiusValue | null;
  crystalRadiusUnavailableReason: "radius-type-absent" | null;
  remarks: string | null;
  remarksUnavailableReason: "not-supplied" | "meaning-unspecified" | null;
};

type ShannonRadiusQuery = DatasetSelection & {
  element: string;
  oxidationState?: number;
  coordination?: string;
  spin?: "high" | "low" | null;
};

type ShannonRadiusLookup = Lookup<
  ShannonRadiusRecord,
  | DatasetUnavailableReason
  | "oxidation-state-required"
  | "coordination-required"
  | "spin-required"
>;
```

- `element`、整数の `oxidationState`、`coordination` は読み込み行に必須。`coordination` は `IVSQ`、`IVPY`、`IIIPY` などの幾何を含むトークンを保持し、単なる配位数の整数へ潰さない。
- スピンの対応は**大文字小文字を区別する完全一致**で、`High Spin` / `hs` / `HS` → `high`、`Low Spin` / `ls` / `LS` → `low`。元のラベルを `spinPrinted` に保持する。空文字だけを `spin: null` と `not-specified-in-source` にし、これを「物理的にスピン依存が無い」と断定しない。未知の非空ラベルを空欄に変えず、その行を拒否する。暗黙の trim・大文字小文字の変換はしない。
- 各半径セルの空欄はそのフィールドの `null` と `radius-type-absent`。片方の欠損理由をもう片方へ適用せず、存在する値は残す。両方が空の行は正常な半径レコードとして登録せず、原入力と欠損の診断を保持する。その条件の検索は `not-in-source` であり、値のない `found` 行を作らない。元の注記は `remarks` に保持し、半径補正に使わない。注記列自体が無ければ `null` と `not-supplied`。列が存在し、形式が空セルを「注記なし」と定義するなら空文字 `""` と理由 `null` を保持する。空セルの意味が未定義なら `null` と `meaning-unspecified` にし、原入力も残す。
- 検索に酸化数・配位が無ければ `unavailable` と各 `*-required` 理由を返す。検索対象に分類済みスピンがあって選択が無ければ `spin-required`。検索の `spin: null` は明示的に出典空欄の行だけを選び、未指定とは区別する。別のスピンや配位へのフォールバックはしない。
- 正常な行が無い検索は `not-in-source`。行があるが特定の半径だけ無い場合は、`found` の行内の個別 `null` と理由を表示する。入力不足やデータセット未読込のために `oxidationState` 等の必須項目を欠いた行を返さない。

未読込の応答例は `{ "status": "unavailable", "record": null, "reason": "no-dataset" }`。数値の穴埋めは含まない。

### 原子量

元素記号と原子番号は行を結ぶ識別子である。以下の物性型は `ElementProperties` の子であり、元素との関連付けなしに単独の行として受け付けない。インポートでは各行の元素記号または原子番号を必須とし、親の `symbol` / `atomicNumber` へ一意に結び付ける。不明・不整合を拒否し、配列の並び順から元素を推測しない。識別子・配置用の骨格（原子番号・元素記号・族・周期）は、第三者物性表の同梱禁止の対象外だが、この ADR では追加しない。E9 で採用元・版と利用条件を別途記録し、骨格から物性値を補わない。名称一覧も今回は同梱しない。CIAAW の標準原子量は相対量として無次元の `"1"` を保ち、`amu`、`u`、`g/mol` へラベルを付け替えない。

```ts
type AtomicWeightFootnote = "g" | "m" | "r";

type StandardAtomicWeight = DatasetPin & {
  unit: "1";
  printed: string;
  footnotes: AtomicWeightFootnote[] | null;
  footnotesUnavailableReason: "not-supplied" | null;
} & (
  | { table: "full"; kind: "interval"; low: string; high: string }
  | {
      table: "full";
      kind: "value-with-uncertainty";
      value: string;
      uncertaintyAbsolute: string;
    }
  | {
      table: "abridged";
      kind: "abridged";
      value: string;
      uncertaintyAbsolute: string;
    }
  | {
      table: "full" | "abridged";
      kind: "unavailable";
      value: null;
      unavailableReason: "no-standard-atomic-weight";
    }
);

type AtomicWeightQuery = DatasetSelection & {
  element: string;
  table: "full" | "abridged";
};

type AtomicWeightLookup = Lookup<
  StandardAtomicWeight,
  DatasetUnavailableReason | "table-not-loaded"
>;
```

- 完全表の区間は `low` と `high` を保持し、単一値や中点にしない。区間の順序を検証する。標準原子量を定めない原表の印は、`kind: "unavailable"`、値 `null` と `no-standard-atomic-weight` にし、原表の印を `printed` に残す。最長寿命核種の質量数で埋めない。
- `uncertaintyAbsolute` は **`value` と同じ無次元単位の、非負の絶対不確かさの十進文字列**。括弧内の数字だけを入れるフィールドではない。簡潔な括弧表記を読む際は、直前の値の最終表示桁と指数に対応させて絶対量へ正確に展開する。合成の書式例 `12.345(6)` なら `value: "12.345"`、`uncertaintyAbsolute: "0.006"`、`printed: "12.345(6)"` であり、絶対不確かさを `"6"` にしない。この例は元素表の数値ではない。
- 簡約表は [CIAAW の明示する値 ± 不確かさ](https://www.ciaaw.org/abridged-atomic-weights.htm)を `kind: "abridged"` としてその桁のまま保存する。完全表と `datasetId`・`table` で区別し、版は各原典の宣言のまま保つ（両方が同じ年号でも混合しない）。区間フィールドを作らない。簡約値 ± 不確かさから完全表の上下限を復元しない。選択したデータセットで要求した `table` 自体が未読込なら `table-not-loaded`、要求した表は読込済みで対象元素が無ければ `not-in-source`。完全表と簡約表の代用はしない。
- `value`、`low`、`high` と `printed` に元の十進精度・末尾ゼロを残す。有効桁数や不確かさの種類（sd、se 等）を推定して追加しない。`printed` と解析した値・不確かさに不一致があれば拒否する。
- 脚注の `g` / `m` / `r` は意味を持つ注記として保持する。`[]` は出典の脚注欄を確認して「脚注なし」と明示された場合だけであり、情報未提供は `null` と `not-supplied`。未知の脚注は落とさず未対応入力として拒否する。

組成計算でのモル質量 `g·mol⁻¹` は、標準原子量の保存単位と区別した派生結果にする。区間から単一値を使うには利用者の明示的な選択を要するか、結果も区間で返す。計算で選んだ値や中点を原データへ書き戻さない。選択・換算・出自の具体的な計算 API は E9 で設計する。

### 電気陰性度と酸化数

電気陰性度は、尺度と**出典が宣言する単位・規格化の約束**を必須にする。例えば Mulliken の `(IE + EA) / 2` はエネルギーであり、出典が `eV` と宣言した値を `"1"` へ変えない。Allen も、エネルギーとしての表現と相対尺度へ規格化した表現を区別する。Pauling を含め、尺度名だけから単位・規格化を補わない。インポート定義にもそれらの宣言が無ければ拒否し、`scale: null` の正常レコードは生成しない。

```ts
type Electronegativity = DatasetPin & {
  scale: "pauling" | "allen" | "allred-rochow" | "mulliken";
  unit: string;
  scaleConvention: string;
  printed: string;
  value: string;
};

type OxidationClassification =
  | { kind: "common" }
  | { kind: "reported" }
  | { kind: "user-specified" }
  | { kind: "other"; label: string };

type OxidationStates = DatasetPin & {
  classification: OxidationClassification;
  values: number[];
};

type OxidationStatesQuery = DatasetSelection & {
  element: string;
  classification: OxidationClassification;
};

type OxidationStatesLookup = Lookup<OxidationStates, DatasetUnavailableReason>;

type ElectronegativityQuery = DatasetSelection & {
  element: string;
  scale: Electronegativity["scale"];
  unit: string;
  scaleConvention: string;
};

type ElectronegativityLookup = Lookup<Electronegativity, DatasetUnavailableReason>;

type ElementProperties = {
  atomicNumber: number;
  symbol: string;
  atomicWeights: PropertyRecords<StandardAtomicWeight>;
  electronegativities: PropertyRecords<Electronegativity>;
  oxidationStates: PropertyRecords<OxidationStates>;
};

```

`ElementProperties` は保存された候補の集合を持つ。検索はそれぞれ `AtomicWeightQuery` → `AtomicWeightLookup`、`OxidationStatesQuery` → `OxidationStatesLookup`、`ElectronegativityQuery` → `ElectronegativityLookup` の契約とする。E9 では登録データセット・表の読込状況も参照し、選択したデータの未読込と、読込済みデータ内の欠測を区別する。検索前の境界で引数と登録 source / dataset の対応を検証し、検証失敗は共通の `Result` で扱う。各配列内では、原子量の完全表・簡約表、酸化数の `common` / `reported` / `user-specified` / `other` を、データセット・出典・版ごとに別レコードとして共存させる。後から読んだものへの置換や分類間の併合はしない。検索は元素と選択した source / dataset に加えて表・分類・尺度を完全一致で指定し、要求しない候補を返さない。同じ選択キーの矛盾する重複行は上書きせず検証失敗にする。

`unit` と `scaleConvention` は空白のみでない、出典または利用者の明示した文字列である。規格化・単位の異なる電気陰性度は比較・換算・穴埋めを自動で行わない。同じ元素の Pauling と Allen などは別レコードとして配列に共存させる。尺度だけでなく、単位・規格化・出典・版の異なるレコードを上書き・混合しない。対応外の尺度や解釈に必要な未知のメタデータは、捨てずに読み込みを拒否する。数値が無いセルは正常な電気陰性度レコードにせず、その入力と診断を保持する。指定した尺度・単位・規格化に一致する数値レコードが無い検索は `Lookup` の `not-in-source` で返す。`found` の中に同じ理由の空レコードを重ねない。

酸化数の `common` は代表的酸化数、`reported` は報告された集合、`user-specified` は利用者の仮定である。明示的な他分類は `other.label` に元の名称を保持する。分類自体が無い行は読み込み時に拒否し、`classification: null` や `classification-unspecified` の正常レコードを作らない。文字列との union で任意の誤記を既知分類として通さず、インポート定義の対応表を必要とする。酸化数集合自体が提供されていなければ、その分類の検索は `Lookup` の `not-in-source` で返す。`values` は静的な形式酸化数の**重複のない有限な整数集合**として検証する。小数・非整数と重複を拒否し、丸めや重複除去で黙って修正しない。`other.label` は空白のみでない元の分類名と完全一致で扱う。`0` は出典がその酸化数を列挙した場合だけ。`[]` を欠損の代わりに使わず、出典が空集合を明示した場合だけ許す。

これらの型例の文字列・配列・null と理由の組み合わせは、後続実装の Valibot 検証で上記の不変条件を満たす必要がある。ここで一般的な単位エンジンや全元素の物性表を先取りしない。

### 共有・エクスポート

[ADR-008](./008-local-server.md) / [ADR-009](./009-command-event-sync.md) / [ADR-010](./010-project-room-identity.md) と実装計画どおり、Room = Project、サーバーが正、Project のデータは通常の snapshot / event / ZIP の対象である。`clientId` は本人認証ではない。この ADR は読込者専用のサーバー領域やクライアント別の秘匿・フィルタを追加せず、「ローカル起動だから本人だけに見える」と約束しない。

第三者表やその抜粋を **Project へ取り込む前**に、対象データ、許容する受領者・利用目的・Room / LAN の範囲・ZIP の保存と受渡し先、必要な帰属表示について、データセット固有の条件とそれを確認した資料・判断を記録するゲートを要する。Project の通常の共有範囲でその条件を守れない場合、条件が不明な場合、またはゲート未実装の場合はインポートを拒否する。URL の存在やチェック操作だけで権利を確認済みとは扱わず、アプリが法的な許諾を付与するものでもない。LAN フラグや Room トークンは技術的なアクセス制御であり、データの利用条件を変更しない。

後続実装では、確認の記録を例えば次の小さな監査情報として Project とデータセットへ結び付ける。型例の ID・日時は共通基盤の形式で検証し、`allowedScope` は対象操作・受領範囲・出力先を特定する説明とする。

```ts
type UsageScopeDecision = DatasetSelection & {
  projectId: string;
  allowedScope: string;
  decision: "allow" | "deny" | "pending";
  decidedBy: string;
  timestamp: string;
  evidenceStatus: "documented" | "unknown";
  evidence: string | null;
};
```

`allow` には空でない範囲・確認資料の説明と `documented` を要し、`unknown` / `pending` のまま Project へ入れない。この記録の主体名は認証の証拠ではなく、`documented` も法的妥当性をアプリが認定した状態ではない。クライアント別のアクセス権や秘匿領域を約束する情報でもない。

ゲートを通ったデータは通常の Project データとして保存・同期し、その派生カード・図・実行履歴も含め、承認した範囲の ZIP export → import で完全に復元する。共有先や出力先が記録した範囲を外れる場合は、その共有・export、または受入側 import を明示的に拒否する。表や派生値だけを黙って落とした snapshot / ZIP を成功として返さない。これはデータ利用範囲の確認を置く契約であり、新たなユーザー別 ACL や権利判定システムの設計ではない。

未確認・未承認ファイルのプレビューを後で提供する場合は、ブラウザの揮発的な表示に限り、Project の Artifact / Command / サーバー永続化・blob / Room / 自動の Python カード入力・結果保存へ送らない。プレビューから Project へ移す時点でも上のゲートが必要である。このプレビュー機能も今回実装しない。

公開サンプルボード、テスト fixture、ドキュメントの例、配布ビルドへ **第三者の数値表やその抜粋**をコミットする場合は、「決定」5 の新しい ADR による同梱ゲートを必須とする。合成と明記した自作のテスト値・書式例、利用者自身の観測は、この第三者表の同梱禁止の対象外であり、それらの保存・試験まで一律に禁じない。機密性や個別の利用条件は別途守る。E8 / §12 の LGPS・Li–Mg サンプルと E2E は、実測・文献値と混同しない合成データで行い、Project の完全な往復を検証する。第三者表を使う試験・公開例への置換は、対応するゲートを満たした後に限る。

## 代替案

1. **Shannon (1976) の表、または pymatgen-core `v2026.10.16` の `Shannon_Radii.csv` を版固定 JSON にする。** 論文の引用と、リポジトリの MIT は確認した。表をこのソフトウェアで再配布してよいとする、IUCr または著者のライセンスファイルは確認していない。採用しない。
2. **prtkm/ionic-radii の `shannon-radii.json`（コミット `228bd51`）を同梱する。** ルートに LICENSE が無い。readme の入手元 URL は、確認日にライセンス文を示していなかった。採用しない。
3. **CIAAW 2024 の表、または PAC 2021 の報告を JSON にして同梱する。** 区間を保てる科学的な表である。impressum は商用利用を事務局への連絡に回し、告知年と表の年がずれている。報告の Crossref license は CC BY-NC-ND 4.0 である。ソフトウェア同梱の許諾としては採用しない。
4. **NIST SP 966 Version 15、または NIST の原子量データベース（最終更新 2015-01）を同梱する。** 前者は簡約値と、一部元素の質量数を含む。後者は 2013 年の原子量の編纂で、製品頁は NIST の臨界評価ではないと書く。いずれも、区間と欠測を保ったうえで再配布できるとは確認していない。採用しない。
5. **Wikipedia の該当頁（上に固定した revid）を CC BY-SA 4.0 で同梱する。** テキストのライセンスは方針頁で読める。原子量の頁は区間を持たず、電気陰性度の頁は複数尺度を含み、酸化数テンプレートは pymatgen の YAML が分類の対応を疑っている。継承ライセンスのデータを、このリポジトリの同梱物にする決定はしない。
6. **欠測を NaN、0、最隣接の配位数、またはイオン半径と結晶半径の差の定数で埋める。** pymatgen の一部 API はその種の挙動を持つ。concept.md §4.1、§4.2、§12.4 はこれを禁じている。採用しない。

## 結果

- 後続の `packages/materials` は、このスキーマを検証する純粋関数と、利用者ファイルの読み込みを実装する。git で管理する第三者物性表、および pymatgen への依存は、この ADR の範囲では追加しない。
- 周期表とイオン半径の画面は、データセットが無いとき各値を `null` と `no-dataset` で示す。半径差の百分率は、両方の半径が同じ定義で存在し、同じ単位または明示的に記録した換算後の単位を用いるときだけ計算する。同じデータセットの出典・版であることを確認し、異なる場合や出典・版を確認できない場合は「異なる／不明な出典・版を含む比較」と明示して利用者が選択した比較にする。`null` 同士を同じ出典・版の証拠にしない。ホスト半径が正でない場合と非有限の結果は、百分率計算を拒否する。原典の負の半径値を削除・補正することはしない。
- Project 確定前の取込範囲ゲートと、範囲外の共有・export / import を明示的に拒否することを後続実装の受け入れ条件に含める。サーバー保存・Room 配信・ZIP 出力の技術的な経路は、再配布の許諾ではない。
- concept.md §15 の Shannon dataset の行と implementation-plan.md の材料データ方針は、この決定を指す。数値表の同梱は、上のゲートを満たす新しい ADR まで再開しない。
- 権利者から、データセット自体の再配布を認める文書が得られたときは、その URL と版を新しい ADR にピンしてから同梱する。この文書の「同梱しない」は、その手続きを禁じない。

## 参照

確認に使った一次の URL と識別子は、上の表に書いた。再掲するものをここにまとめる。

- Shannon (1976): <https://doi.org/10.1107/S0567739476001551>
- IUCr copyright policy（Crossref がこの DOI の license URL としている）: <https://journals.iucr.org/services/copyrightpolicy.html>
- IUCr permissions: <https://journals.iucr.org/services/permissions.html>
- pymatgen-core `v2026.10.16` = `cddebfb21ed5acaee3987948b6704a2790d4e056`、LICENSE: <https://github.com/materialsproject/pymatgen-core/blob/v2026.10.16/LICENSE>
- pymatgen `v2026.10.24` = `e3fdb6d4bb2a3bc1622f4c133e088d660f0c3c26`、LICENSE: <https://github.com/materialsproject/pymatgen/blob/v2026.10.24/LICENSE>
- prtkm/ionic-radii `228bd51d76ac1ae9a16f17aca574b7af407c541e`: <https://github.com/prtkm/ionic-radii>
- abulafia（2026-10-26 に HTTP 200、ライセンス文は見当たらず）: <http://abulafia.mt.ic.ac.uk/shannon/ptable.php>
- IUPAC Gold Book、電気陰性度（Mulliken / Pauling の定義）: <https://goldbook.iupac.org/terms/view/E01990>
- Allen の分光学的定義: <https://doi.org/10.1021/ja00207a003>
- CIAAW 簡約標準原子量: <https://www.ciaaw.org/abridged-atomic-weights.htm>
- CIAAW 標準原子量: <https://www.ciaaw.org/atomic-weights.htm>、告知: <https://www.ciaaw.org/impressum.htm>
- PAC 2021、Crossref license は CC BY-NC-ND 4.0: <https://doi.org/10.1515/pac-2019-0603>
- NIST open license: <https://www.nist.gov/open/license>、SRD: <https://www.nist.gov/srd/public-law>
- NIST SP 966: <https://www.nist.gov/pml/periodic-table-elements>
- Wikipedia の著作権方針: <https://en.wikipedia.org/wiki/Wikipedia:Copyrights>
- concept.md §4.1、§4.2、§7.3、§12.4、§15、§16
- GitHub issue #27
