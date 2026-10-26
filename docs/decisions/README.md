# Architecture Decision Records

ADR-001〜007 は [concept.md §17](../concept.md#17-設計判断ログadr簡易版) の表に記録されている。ADR-008 以降は本ディレクトリで管理する。文書の採択と実装完了は区別する。

- [ADR-008: ローカルサーバーと永続化](./008-local-server.md)（ADR-001 を置き換える）
- [ADR-009: サーバー権威の Command / Event 同期](./009-command-event-sync.md)
- [ADR-010: Project 単位の Room と利用者識別](./010-project-room-identity.md)
- [ADR-011: Hono HTTP + ws、node:sqlite、SQL と Node の開発・ビルド方式](./011-server-stack.md)
- [ADR-012: 科学データの出典、再配布、欠損の表現](./012-scientific-data-sources.md)

新しい ADR は、ステータス・日付・関連 Issue、文脈、決定、代替案、結果、参照を記録する。判断を変更する場合は新しい ADR から旧判断を参照し、置き換える範囲を明示する。
