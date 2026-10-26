# Hypothesis Graph — 実装計画

> 設計要件の正は [concept.md](./concept.md)。本書は「ローカルサーバー + WebSocket Room」で実装するための計画であり、concept.md と食い違う箇所は本書の **0. 前提の改訂** を優先する。
> 作成日: 2026-10-26

---

## 0. 前提の改訂（concept.md との差分）

| 項目 | concept.md | 本計画 | 理由 |
|---|---|---|---|
| 実行形態 | サーバー不要のローカルファーストSPA (ADR-001) | **手元PCで起動するローカルサーバー + ブラウザ** | WebSocket Room による同時閲覧・議論を可能にするため |
| 共同編集 | 初期版ではやらない (§1.5) | **Room（=Project）単位でリアルタイム同期**。権限管理・本格認証は引き続きM4 | 「discussion room」用途 |
| 永続化 | IndexedDB(Dexie) + OPFS | **サーバー側 SQLite + ファイルシステム(blob)** | 複数クライアントの単一の正(source of truth)が必要 |
| AI接続 | 後期にサーバープロキシ | **最初からサーバー側 AiProvider**（APIキーはサーバーの環境変数のみ） | キーをフロントに置かない |
| Python | Pyodide + Web Worker | **変更なし**（実行はクライアント、結果はサーバーに保存し Room に共有） | サーバーで任意コード実行をしない |
| ビルド | Vite (+ Vite Plus 可) | **pnpm workspace + Vite+ (`vp`)** | 指定 |

上記以外（Artifact/CanvasItem 分離、3種の線、DAG、AI差分承認、Provenance、科学的制約など）は concept.md をそのまま踏襲する。

## 1. アーキテクチャ

```text
┌──────────── Browser (n clients) ────────────┐        ┌──────────── Local Server (Node) ─────────────┐
│ React UI / React Flow canvas                │  WS    │ Hono HTTP + WebSocket                        │
│ Zustand (UI state + 楽観的更新)             │◀──────▶│ RoomManager (Room = Project)                 │
│ WS client (再接続・resume)                  │        │ Command pipeline                             │
│ Pyodide module Worker (計算)                │  HTTP  │   Valibot検証 → domain.apply (純粋関数)      │
│ Materials toolbox (純粋関数)                │◀──────▶│   → SQLite トランザクション → event log      │
└─────────────────────────────────────────────┘        │   → Room へ broadcast                         │
                                                       │ Blob store (dataDir/blobs/<sha256>)           │
                                                       │ AiProvider adapter (M3)                       │
                                                       │ 静的配信 (web build, Pyodide アセット)        │
                                                       └───────────────────────────────────────────────┘
```

### 1.1 同期方式: サーバー権威の Command / Event

- クライアントは **Command** を送る。サーバーが Valibot 検証 → `packages/domain` の純粋関数で適用 → SQLite に保存 → **Event（seq 付き）** を Room 全員へ配信する。
- クライアントは楽観的に適用し、`reject` を受けたらロールバックする。
- 各エンティティは `version` を持つ。位置・サイズは LWW、本文などの内容更新は `baseVersion` 不一致時にフィールド単位でマージ可否を判定し、不可なら reject。テキストは編集中ソフトロック（Presence）で衝突を避ける。
- 再接続時は `lastSeq` 以降の event を再送（古すぎる場合はスナップショット）。
- **CRDT (Yjs) は採用しない。** 監査ログ（誰が・なぜ・何を）、境界での検証、AI 提案の承認フローとサーバー権威モデルの相性を優先する。テキスト同時編集の要求が強くなったら再検討（ADR化）。

### 1.2 WebSocket メッセージ（概略）

```text
C→S  hello      {protocolVersion, clientId, displayName, token?}
C→S  join       {projectId, lastSeq?}
S→C  joined     {projectId, seq, snapshot | events[], members[]}
C→S  command    {commandId, projectId, baseVersion?, command}
S→C  ack        {commandId, seq}
S→C  reject     {commandId, code, message, current?}
S→C  event      {seq, projectId, actor, commandId, events[]}
C↔S  presence   {boardId, cursor?, selection[], editingItemId?}   ※非永続・間引き
S→C  member     {joined | left, member}
C↔S  ping/pong
```

### 1.3 Room とスコープ

- **Room = Project**。Artifact は Project スコープで複数 Board から参照されるため、Project 単位で配信すれば整合が取りやすい。クライアントは表示中 Board 以外の CanvasItem event は状態に反映するだけで描画しない。
- 利用者識別は `clientId`（localStorage）+ 表示名。本格認証は M4。
- サーバーはデフォルト `127.0.0.1` で待受。LAN 公開は明示フラグ + Room トークン必須。

### 1.4 リポジトリ構成（pnpm workspace + Vite+）

```text
discussion-room/
├── apps/
│   ├── web/          # React + TS + React Flow + Tailwind + shadcn/ui + Zustand
│   └── server/       # Node + Hono + WebSocket + SQLite
├── packages/
│   ├── domain/       # 型・Valibotスキーマ・純粋関数（Command適用、グラフ検証、物理量）
│   ├── protocol/     # WSメッセージスキーマとバージョン
│   └── materials/    # 元素・イオン半径・組成計算（純粋関数 + 版固定データ）
├── tests/e2e/        # Playwright（server + web を起動、複数クライアント）
├── docs/
│   ├── concept.md
│   ├── implementation-plan.md
│   └── decisions/    # ADR
├── vite.config.ts    # Vite+ ルート設定（lint/fmt/test の overrides）
├── pnpm-workspace.yaml
└── AGENTS.md
```

- 開発: `vp run -r --parallel dev`（web の Vite dev server が `/api` `/ws` をサーバーへ proxy）。
- 本番相当: `pnpm start` で web をビルド済み静的ファイルとしてサーバーが配信（単一ポート）。
- 品質: `vp check`（fmt + lint + typecheck）、`vp test`、`vp build` を CI で実行。

## 2. 開発フロー（GitHub flow）

1. `main` は常にビルド・テストが通る状態を保つ（ブランチ保護 + CI 必須）。
2. sub-issue 1件 ≒ 1 ブランチ ≒ 1 PR。ブランチ名は `feat/<issue番号>-<短い説明>`（`fix/` `chore/` `docs/` `spike/`）。
3. PR 本文に `Closes #<sub-issue>` を書く。親 issue（エピック）は全 sub-issue 完了で閉じる。
4. CI（`vp check` / `vp test` / `vp build`）緑 + セルフレビュー後にマージ。マージ後ブランチ削除。
5. スパイクの成果はコードを捨ててもよいが、結論は `docs/decisions/` の ADR に残す。

## 3. マイルストーンとエピック

| # | エピック | MS | 主な成果 |
|---:|---|---|---|
| E0 | 開発基盤（pnpm + Vite+ モノレポ / CI / GitHub flow） | M0 | `vp check/test/build` が CI で通る |
| E1 | 技術スパイク | M0 | 主要な不確実性の解消と ADR |
| E2 | ドメインモデルとスキーマ (`packages/domain`) | M1 | Artifact/CanvasItem 分離、Command 適用の純粋関数 |
| E3 | リアルタイム同期プロトコル (`packages/protocol`) | M1 | メッセージ契約、resume、競合方針 |
| E4 | ローカルサーバー (`apps/server`) | M1 | Room・永続化・Command パイプライン |
| E5 | Web クライアント基盤とキャンバス | M1 | 3ペインUI、WS クライアント、Presence |
| E6 | 研究カードと関係線 | M1 | 基本カード、Semantic Relation、Inspector |
| E7 | 編集操作と履歴 | M1 | Undo/Redo、複製、検索、スナップショット |
| E8 | Import/Export とサンプルボード | M1 | ZIP round-trip、LGPS / Li–Mg サンプル |
| E9 | 材料科学 Toolbox | M2 | 周期表、Shannon 半径、組成計算 |
| E10 | Python/Wasm 計算 | M2 | Pyodide Worker、Python カード、実行記録 |
| E11 | データ・グラフ・Dataflow | M2 | CSV → Table → Python → Chart |
| E12 | E2E テストと品質ゲート | M1–M2 | 代表 E2E、§12.4 禁止事項の自動検証 |
| E13 | AI Research Partner | M3 | サーバー側 AiProvider、提案差分の承認 |
| E14 | 科学拡張（CIF / 電気化学 / 文献 / Evidence） | M3 | 電池研究向けプラグイン群 |

M4（研究室データ基盤連携・権限管理など）は issue 化しない。

### 3.1 依存関係と推奨順序

```text
E0 ──▶ E1 ──▶ E2 ──▶ E3 ──▶ E4 ──┐
                 │                 ├──▶ E6 ──▶ E7 ──▶ E8 ──▶ (M1 完了)
                 └────────▶ E5 ────┘
E2 ──▶ E9 (materials は純粋関数なので E4/E5 と並行可)
E5 + E1(Pyodide) ──▶ E10 ──▶ E11 ──▶ (M2 完了)
E12 は E5 以降、各エピックと並走して E2E を追加
E8 + E11 ──▶ E13 / E14 (M3)
```

### 3.2 マイルストーン完了条件

- **M0:** 2 つのブラウザで同じ Room に入り、Markdown カードの移動が同期される。Pyodide で NumPy 計算ができ、Stop 後に復帰できる。主要 ADR が揃っている。
- **M1:** 研究者が仮説・予測・実験計画を記録し、別クライアントからも同時に閲覧・編集でき、サーバー再起動後も復元される。ZIP の round-trip が成功する。
- **M2:** 周期表 → イオン半径 → Python → グラフの Dataflow がボード上で完結し、実行来歴が残る。
- **M3:** AI 提案 → 研究者承認 → 計算・実験計画 → 観測取り込み → 解釈、の一連が実行できる。承認しない提案は DB に一切反映されない。

## 4. 横断ルール

- concept.md §8.5 の TypeScript 規約に従う（strict、class を使わない domain、`unknown` → Valibot、Result 型）。
- UI からは SQLite・Pyodide を直接触らない。サーバー側でも HTTP/WS ハンドラに domain ロジックを書かない。
- 科学的制約（欠損値をゼロにしない、単位を勝手に変えない、AI 出力の出自保持）は各 issue の受け入れ条件に含める。
- 各 sub-issue は「受け入れ条件」とテスト（Vitest / Playwright）を必須とする。
