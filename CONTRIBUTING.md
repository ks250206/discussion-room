# Contributing

このリポジトリは GitHub flow で開発する。設計の正は [docs/concept.md](docs/concept.md) と [docs/implementation-plan.md](docs/implementation-plan.md)、コーディング規約は [docs/coding-conventions.md](docs/coding-conventions.md)。

## 流れ

1. 着手する sub-issue を選ぶ（依存関係は [implementation-plan.md §3.1](docs/implementation-plan.md#31-依存関係と推奨順序)）。
2. `main` から作業ブランチを切る。**sub-issue 1 件 = 1 ブランチ = 1 PR**。
3. 変更後、ローカルで `vp check` と `vp test` を通す。
4. PR を作成する。テンプレートの各欄を埋め、本文に `Closes #<issue番号>` を書く。
5. CI（`check / test / build`）が緑になり、セルフレビューを終えたら **squash merge** する。マージ後ブランチは自動で削除される。
6. エピック（親 issue）は、すべての sub-issue が完了したら閉じる。

## ブランチ命名

`<種別>/<issue番号>-<短い説明>`。説明は英小文字のケバブケース。

| 種別     | 用途                                            | 例                             |
| -------- | ----------------------------------------------- | ------------------------------ |
| `feat/`  | 機能追加・基盤整備                              | `feat/16-monorepo-init`        |
| `fix/`   | 不具合修正                                      | `fix/123-relation-cycle-check` |
| `chore/` | 設定・依存更新・運用                            | `chore/130-bump-vite-plus`     |
| `docs/`  | ドキュメントのみ                                | `docs/140-adr-sync-protocol`   |
| `spike/` | 技術検証。コードは捨ててよいが結論は ADR に残す | `spike/22-server-stack`        |

## issue と PR の書き方

- issue はテンプレート（feature / bug / spike）から作る。sub-issue には `親エピック: #<番号>` を書き、受け入れ条件に `vp check` / `vp test` が通ることを含める。
- PR のタイトルは issue と同じ `[E<エピック>.<番号>] <タイトル>` にする。squash merge のコミットタイトルは PR タイトルになるよう設定している（コミット数にかかわらず）。
- PR 本文の `Closes #<番号>` で、マージ時に issue が自動で閉じる。複数ある場合は `Closes #1, closes #2` のようにそれぞれ書く。
- スパイクの結論は `docs/decisions/` に ADR として残し、PR から参照する。

## マージ方針

- マージ方法は **squash merge のみ**（merge commit と rebase merge はリポジトリ設定で無効）。`main` の履歴は 1 PR = 1 コミットになる。
- マージ条件は CI の `check / test / build` が成功していること、かつ PR ブランチが `main` の最新に追従していること。
- レビュー承認は必須にしていない（少人数開発のため）。代わりにセルフレビューと、必要に応じて AI レビューの指摘対応を PR 本文に残す。

## main のブランチ保護

`main` には次の保護を設定している。

| 設定                      | 値                                           |
| ------------------------- | -------------------------------------------- |
| PR 必須（直接 push 禁止） | 有効。承認数は 0                             |
| 必須ステータスチェック    | `check / test / build`（最新への追従も必須） |
| 管理者にも適用            | 有効                                         |
| 直線的な履歴              | 有効（squash merge と整合）                  |
| force push / ブランチ削除 | 禁止                                         |

必須チェックに `e2e` だけを指定してはいけない。`e2e` は `check / test / build` に依存するため、前段が失敗すると skip になり、GitHub は skip を成功扱いにする。

設定の再適用は、リポジトリ管理者が次のコマンドで行う（GitHub の Settings → Branches からでも同じ設定ができる）。

```sh
gh api -X PUT repos/ks250206/discussion-room/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": { "strict": true, "contexts": ["check / test / build"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF

gh repo edit ks250206/discussion-room \
  --enable-squash-merge --squash-merge-commit-message pr-title \
  --enable-merge-commit=false --enable-rebase-merge=false \
  --delete-branch-on-merge
```

## ローカルでの確認

```sh
pnpm install
vp check          # fmt + lint + typecheck
vp test           # 全パッケージのテスト
vp build          # apps/web のビルド
vp run -r build   # 全パッケージの build
```
