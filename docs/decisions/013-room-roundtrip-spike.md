# ADR-013: Project Room の最小往復と計測

- ステータス: スパイク実装・実通信確認済み。本番 Room / Command / 永続化の採択・完了を意味しない
- 日付: 2026-10-27
- 関連: #23（親 #2）、前提 #22 / [ADR-011](./011-server-stack.md)
- 設計の正: [implementation-plan.md](../implementation-plan.md) §0、§1.1–1.3、[ADR-009](./009-command-event-sync.md)、[ADR-010](./010-project-room-identity.md)

## 範囲と実装

`apps/server/src/spikes/room-roundtrip/` のみで、loopback HTTP と `ws` の二つのクライアントが Project 単位の Room に参加し、合成カード一つの座標を共有する。単一プロセスのメモリに最新座標と増分 revision を持つ。最終到着順でサーバーが適用し、送信者を含む同じ Room へ position を配信し、送信者へ requestId 付き ack を返す。join はその時点の snapshot と members を返す。明示 leave / socket close / heartbeat timeout は membership を除く。空 Room の座標も同じプロセス内で保持し、再接続では新しい snapshot を取得する。

合成カードは研究上の仮説・観測・根拠ではない。既存 `apps/server/src/main.ts` / `app.ts`、`packages/protocol` / `domain`、`apps/web`、stack spike のコマンドを変更しない。サーバー再起動後の保持、SQLite、Event log、Command の重複排除、baseVersion、lastSeq からの再送、利用者の本人確認は実装しない。接続 ID は接続ごとの UUID であり、ADR-010 の永続 clientId ではない。revision はこの実験内の適用順だけを示す。

## 制限と接続境界

- 実行 CLI は `127.0.0.1` の未使用ポートにのみ bind する。Host はそのポートの `127.0.0.1` / `localhost` のみ。Origin があれば Host と同一の HTTP origin のみ許可する。WS は `/ws` 完全一致、同一 Origin の明示を必須とし、`handleUpgrade` 前に拒否する。LAN 公開機能はない。
- JSON text のみ。maxPayload は 2048 bytes。unknown から Valibot strictObject で type / 余分なフィールド / Room ID / requestId / 有限な整数座標を検証する。座標範囲は実験用固定平面の x=0..560、y=0..300（表示座標、科学的単位ではない）。部屋の指定は join のみであり、move で他 Room を指定できない。
- 最大 32 接続、16 Room、各 8 メンバー。Room 上限到達時は新規 Room を拒否する。空 Room の自動削除は行わず、保持する Room 数を制限する。加入失敗時は既存サーバー membership を維持する。
- 接続ごとに固定窓 1 秒あたり 120 inbound JSON frames まで。超過は 1008、binary は 1003、過大 payload は 1009 で終了する。固定窓は境界付近の短いバーストを許す。バックプレッシャーは送信前の bufferedAmount >64 KiB で terminate。単一フレーム分の追加はあり得る。
- native ping / pong を 5 秒ごとに行い、次の走査で pong 未応答を terminate する。ブラウザは pong を自動応答する。新規接続が 5 秒を過ぎても一度も join しない場合も走査時に終了する。走査タイミングとイベントループにより検出時刻は変わる。正常 leave 後の接続も接続数上限・heartbeat の対象。
- close は idempotent で、interval、HTTP、全 WS と Room state を解放する。プロセス外へデータ送信しない。

## 簡易計測と送信頻度

再現: `vp run --filter ./apps/server spike:room:measure`。Node 24.22.1、同一ローカルプロセスの実 WS クライアント 2、合成カード一つ、永続化なしで、各周波数につき約 1 秒。送信者の `performance.now()` で move 送信から対応 ack 受信までを測る。両端とも同じクライアント時計であり、別クライアントの時計の差分ではない。受信者も position 受信を確認するが、その片道遅延や browser rendering 時間は測らない。頻度は時計に沿った送信目標で、ack が遅ければ達成頻度は下がる。

2026-10-27 の一回の実測（負荷保証やベンチマークではない）:

| 目標 Hz | 経過 ms | moves / inbound JSON | outbound JSON | ack RTT p50 ms | p95 ms |
|---:|---:|---:|---:|---:|---:|
| 10 | 1001.55 | 10 / 10 | 30 | 0.87 | 2.16 |
| 20 | 1001.40 | 20 / 20 | 60 | 0.77 | 2.07 |
| 30 | 1000.53 | 30 / 30 | 90 | 1.11 | 2.05 |
| 60 | 1000.52 | 60 / 60 | 180 | 1.05 | 1.38 |

一回の move は 2 人 Room で position×2 + ack×1 = 3 outbound JSON frames。native heartbeat / TCP / HTTP のフレームや bytes は表に含めない。20 Hz は 60 Hz の 1/3 のメッセージ量で、今回の短い loopback RTT はいずれも小さかった。**ドラッグの初期値を 20 Hz とし、pointerup の最終位置を即送信する**案を後続で検証する。60 Hz の p95 が小さいことを周波数の優劣の根拠にしない。20 Hz は最適値の実証ではない。Room 人数、DB commit、遅い接続、実ブラウザ描画、競合を含めて再計測する必要がある。

UI は送受信 JSON 数、移動数、計測開始後の実効 Hz、最後の最大 1000 ack RTT の p50 / p95 を表示する。実効 Hz は待機時間も含み、最終位置の即送信は一時的に設定上限を超え得る。pending ack は最大 128 件・10 秒までのサンプル候補に制限する。Reset はこのタブの計測だけをリセットする。

## E3 / E4 への引継ぎ

- **E3 (#33 ほか)**: 実験の `join/move/leave/snapshot/position/ack` を製品契約へそのまま公開しない。hello / protocolVersion / stable clientId、検証失敗 code、lastSeq、snapshot と再送の境界、ack と event の順序、重複 commandId、複数 Board の Project 配信、Presence の非永続な間引きを正式スキーマに落とす。requestId は RTT 相関用のみで、重複排除はない。
- **E4 (#39 ほか)**: Room Manager の接続・membership・timer の所有者を明示する。join 前接続上限、membership 解除、room 切替、空 Room の状態、slow client を残さない終了、shutdown を実通信テストする。今回の snapshot はメモリの値であり、製品版は永続化・Event log の commit 後配信と整合する必要がある。
- Host / Origin は loopback でも HTTP と WS の両方で検証する。LAN の明示フラグ・Room token は本スパイクから導出しない。
- position の last-arrival 適用は、内容フィールドの競合解決や科学的判断の合意を表さない。AI 提案の承認・provenance も別要件。
- 周波数と Room 人数から fanout メッセージ量を見積もり、最終座標の到達保証、遅い接続、再接続中の未確定な楽観表示の扱いを実装時に決める。ここでは切断前に未達だった move を再送しない。

## 検証と手動再現

実通信テストは、同 Room の移動、別 Room への非配信、leave 後の拒否、切替、空 Room 後の再接続、再起動時リセット、no-pong 接続の除去とメンバー通知、malformed / extra / 非有限 / 範囲外入力、binary / 過大 payload、room/member/client/rate 上限、Host / Origin と exact path、shutdown を確認する。slow transport は bufferedAmount getter を閾値超えにする決定的注入と実 socket の終了・再参加で検証する。OS バッファを実際に飽和させる負荷試験ではない。

```sh
pnpm install --frozen-lockfile
vp check
vp test
vp build
vp run -r build
vp run --filter ./apps/server spike:room:build
vp run --filter ./apps/server spike:room:start
# 開発時は代わりに:
# vp run --filter ./apps/server spike:room:dev
```

1. stdout の `http://127.0.0.1:<port>/?project=demo` を Chrome の二つのタブで開く。両方に joined、Room=demo、members=2 が出る。
2. 一方の Synthetic card をドラッグする。両方のサーバー確定座標と revision が一致することを、pointerup 後に確認する。キーボードの矢印キーでも移動できる。
3. 一方で「切断」を押し、他方で移動後、「再接続」を押す。最新 snapshot の座標に復帰する。明示「退出」後は動かせず、他方の members は 1 になる。
4. 一方を別 Project Room に参加させ、移動が元 Room に流れないことを確認する。
5. 送信上限を 10 / 20 / 30 / 60 Hz へ変更し、計測を reset してドラッグする。JSON 数と ack RTT を比較する。RTT が別クライアントへの片道遅延でないことを保持する。
6. 400px 幅は横スクロール可能な固定実験平面となる。見えているカードをドラッグまたは focus 後の矢印キーで移動する。ページ自体が横にはみ出さないことを確認する。
7. Ctrl-C で終了し、再起動後に初期合成座標へ戻る。プロジェクト保存の検証として扱わない。

二つの実 Chrome タブによる同期の[スクリーンショットと操作記録](../evidence/23-room-roundtrip/README.md)を保存した。実ドラッグ後の両タブは 320,190 / revision 3、B 切断中に A を更新した後の B 再接続は 330,200 / revision 5 で一致した。CLI 計測・WS 自動テストをブラウザ画面の同期証拠として代用しない。

## 出典

- [ws README: broken connection detection](https://github.com/websockets/ws#how-to-detect-and-close-broken-connections)、[upgrade 前の検証](https://github.com/websockets/ws#client-authentication)
- [ws API: maxPayload / bufferedAmount / autoPong](https://github.com/websockets/ws/blob/master/doc/ws.md)
- ローカルの実装と実行結果。後続 E3/E4 の実装はこの ADR の計測とは別途確認する。
