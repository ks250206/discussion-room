# AGENTS.md

## 正とするドキュメント

- 設計の正は [docs/concept.md](docs/concept.md) と [docs/implementation-plan.md](docs/implementation-plan.md)。両者が食い違う場合は implementation-plan.md の「0. 前提の改訂」を優先する。
- コーディング規約と静的検査（tsconfig・lint・fmt のルール一覧と根拠）は [docs/coding-conventions.md](docs/coding-conventions.md)。
- ブランチ・PR・マージの運用は [CONTRIBUTING.md](CONTRIBUTING.md)。
- 技術判断の記録（ADR）は `docs/decisions/`。

## 構成

| パス                 | 内容                                           |
| -------------------- | ---------------------------------------------- |
| `apps/web`           | React + TypeScript の Web クライアント         |
| `apps/server`        | Node のローカルサーバー                        |
| `packages/domain`    | ドメインの型・スキーマ・純粋関数（class 禁止） |
| `packages/protocol`  | WebSocket メッセージのスキーマ                 |
| `packages/materials` | 元素・イオン半径・組成計算                     |
| `tools/lint`         | 自作 lint ルール（Oxlint JS プラグイン）       |

`packages/*` は Web とサーバーの両方から使うため、Node 組み込みモジュールと React に依存させない（lint で強制）。

## コマンド

```sh
pnpm install                       # 依存のインストール
vp check                           # fmt + lint + typecheck
vp check --fix                     # fmt と自動修正可能な lint を適用
vp test                            # 全パッケージのテスト
vp build                           # apps/web のビルド
vp run -r build                    # 全パッケージの build スクリプト
vp run --filter ./apps/web dev     # web dev server
vp run --filter ./apps/server dev  # server（node --watch）
```

## コーディング規約（要点）

詳細と根拠は [docs/coding-conventions.md](docs/coding-conventions.md)。

- `any` 禁止。外部データは `unknown` として受け、Valibot で検証する。
- ドメインロジックは class ではなく型と純粋関数で書く。予想可能なエラーは `Result<T, E>` で返し、通常の入力エラーで throw しない。
- 可変のグローバル状態を作らない。React UI 層に単位換算や科学的判定ロジックを書かない。
- 科学的制約: 欠損値をゼロや既定値で埋めない、単位を黙って変えない、AI 出力の出自を保持し、承認されていない提案を保存しない（concept.md §12.4）。

## 作業の進め方

- sub-issue 1 件 = 1 ブランチ = 1 PR。ブランチ名は `feat/<issue番号>-<slug>`（`fix/` `chore/` `docs/` `spike/`）。
- PR 本文に `Closes #<issue番号>` を書き、PR テンプレートの各欄を埋める。
- 変更後は `vp check` と `vp test` が通ることを確認する。CI の必須チェックは `check / test / build`。
- `main` は保護されており、直接 push できない。変更は必ず PR 経由で squash merge する。
