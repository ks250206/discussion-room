# discussion-room

研究仮説・予測・実験計画をボード上で議論するためのローカルサーバー + ブラウザアプリ。設計は [docs/concept.md](docs/concept.md) と [docs/implementation-plan.md](docs/implementation-plan.md) を参照。

## 必要環境

- Node.js 24（`.node-version`）
- pnpm 12.15.0（`packageManager`）
- [Vite+](https://viteplus.dev/)（`vp`）

## 構成

| パス                 | 内容                                     |
| -------------------- | ---------------------------------------- |
| `apps/web`           | React + TypeScript の Web クライアント   |
| `apps/server`        | Node のローカルサーバー（`/api/health`） |
| `packages/domain`    | ドメインの型・スキーマ・純粋関数         |
| `packages/protocol`  | WebSocket メッセージのスキーマ           |
| `packages/materials` | 元素・イオン半径・組成計算               |

## コマンド

```sh
pnpm install

vp check                          # fmt + lint + typecheck
vp test                           # 全パッケージのテスト
vp build                          # apps/web のビルド（defaultPackage）
vp run -r build                   # 全パッケージの build スクリプト

vp run --filter ./apps/web dev    # web dev server
vp run --filter ./apps/server dev # server（node --watch）
```
