# コーディング規約と静的検査

[concept.md §8.5](./concept.md#85-typescriptコーディング規約) の TypeScript 規約のうち、ツールで強制できるものを `vp check`（fmt + lint + typecheck）で強制する。設定の実体はルートの `vite.config.ts`（fmt / lint）と `tsconfig.base.json`（型検査）。

## TypeScript（`tsconfig.base.json`）

すべてのパッケージが `tsconfig.base.json` を継承する。

| オプション                                     | 採否 | 根拠                                                                                                             |
| ---------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| `strict`                                       | 採用 | §8.5 の前提。                                                                                                    |
| `noUncheckedIndexedAccess`                     | 採用 | 配列・辞書の欠損を `undefined` として扱わせる。欠損値を黙ってゼロや既定値にしない科学的制約と合う。               |
| `exactOptionalPropertyTypes`                   | 採用 | 「プロパティがない」と「`undefined` が入っている」を区別する。JSON payload や Valibot スキーマと型を一致させる。 |
| `noImplicitReturns` / `noImplicitOverride`     | 採用 | 分岐漏れと意図しない上書きを防ぐ。                                                                               |
| `noUnusedLocals` / `noUnusedParameters`        | 採用 | 未使用コードを残さない（lint の `no-unused-vars` と二重に検出される）。                                          |
| `verbatimModuleSyntax` / `erasableSyntaxOnly`  | 採用 | 型のみの import を明示させる。`enum` や `namespace` を禁止し、Node の型ストリップで直接実行できる形に保つ。       |
| `noPropertyAccessFromIndexSignature`           | 不採用 | `process.env["X"]` のような書き方を強いるだけで、安全性への寄与が小さい。                                      |

`apps/web` はバンドラ前提で `moduleResolution: "bundler"` に上書きする。そのほかは `nodenext`。

## Lint（`vite.config.ts` の `lint`）

Oxlint を使い、`typeAware` と `typeCheck` を有効にしている（型情報を使うルールと型検査を `vp check` で一度に実行する）。

### 全体

- `correctness` と `suspicious` カテゴリを **error** にする。warning は `vp check` を落とさず放置されやすいため、使わない。
- 個別に error にしているルール:

| ルール                                                                     | 根拠                                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `typescript/no-explicit-any`                                               | §8.5「`any` 禁止。外部データは `unknown` → Valibot」。                         |
| `typescript/no-unsafe-{argument,assignment,call,member-access,return}`     | `any` が型推論で紛れ込んだ場合も検出する。                                     |
| `typescript/no-non-null-assertion`                                         | `!` で欠損を握りつぶさない。                                                   |
| `typescript/no-floating-promises` / `typescript/no-misused-promises`       | WebSocket・DB・Worker まわりの未処理 Promise を防ぐ。                          |
| `typescript/switch-exhaustiveness-check`                                   | Command / Event などの判別共用体で分岐漏れを防ぐ。                             |
| `no-unused-vars`, `eqeqeq`                                                 | 一般的な不具合の予防。                                                         |
| `no-console`                                                               | ログは境界（サーバー・ツール）でのみ出す。`apps/server` と `tools` では許可。 |
| `vite-plus/prefer-vite-plus-imports`                                       | `vite` / `vitest` ではなく `vite-plus` からの import に統一する。              |

### パッケージ別の overrides

| 対象                  | 内容                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/**`         | `react` / `jsx-a11y` プラグインを追加し、ブラウザ環境にする。フックの規則と effect の依存配列は correctness カテゴリで検査される。`only-export-components` も error。 |
| `apps/server/**`      | Node 環境にし、`no-console` を許可する。                                                                                                                             |
| `packages/**`         | `node:*`・`react`・`react-dom` の import を禁止する（`no-restricted-imports`）。共有パッケージは Web とサーバーの両方から使うため、プラットフォームに依存させない。 |
| `packages/domain/**`  | class を禁止する（後述の `discussion-room/no-class`）。                                                                                                              |
| `**/*.test.{ts,tsx}`  | `vitest` プラグインを追加し、`no-focused-tests`・`no-disabled-tests`・`no-identical-title` を error にする。                                                         |

### `packages/domain` の class 禁止

§8.5「ドメインロジックは class ではなく型と純粋関数を中心に実装する」は、Oxlint の JS プラグインで自作ルール `discussion-room/no-class`（[`tools/lint/plugin.ts`](../tools/lint/plugin.ts)）として強制する。`class` 宣言・`class` 式の両方を検出する。ルール自体は `RuleTester` でテストしている（[`tools/lint/plugin.test.ts`](../tools/lint/plugin.test.ts)）。

レビュー項目として残るもの（lint では表現しない）:

- 予想可能なエラーは `Result<T, E>` で返し、通常の入力エラーで throw しない。
- 可変のグローバル状態を作らない。
- React UI 層に単位換算や科学的判定ロジックを書かない。

## フォーマット（`vite.config.ts` の `fmt`）

Oxfmt の既定値（ダブルクォート、セミコロンあり、末尾カンマあり）に従い、`printWidth` は 100 に固定する。`docs/**` は対象外にしている。設計ドキュメントは日本語の表が多く、自動整形すると内容と関係のない大きな差分が出るため。

## 違反の検出を確認した例

次の違反はいずれも `vp check` で失敗する。

- `any` の使用、未使用変数、フォーマット崩れ
- `packages/domain` 内の `class`（`packages/protocol` では検出しない）
- 共有パッケージからの `node:fs` / `react` の import
- 条件付きのフック呼び出し、effect の依存配列の漏れ
- `test.only`
- `noUncheckedIndexedAccess` による `number | undefined` の代入
