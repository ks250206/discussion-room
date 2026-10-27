# ADR-014: React Flow カードと装飾オーバーレイの座標同期

- ステータス: 座標同期の基盤として React Flow 継続を条件付きで採択。実ブラウザ操作確認済み。200枚の本番性能は未受入。独立スパイクであり、製品キャンバスの完成ではない。
- 日付: 2026-10-27
- 関連: #24（親 #2）、前提 #16、concept.md §2.2 / §2.4 / §8.2 / §15、implementation-plan.md §0

## 文脈と決定

リサイズ可能な Markdown カードを React Flow の custom node と `NodeResizer` で実装し、自由描画を `ViewportPortal` の SVG に置く。portal はノードと同じ viewport の変換を受けるため、独自に pan / zoom の CSS transform を追従させる二重管理を避けられる。React Flow を座標同期の初期基盤として継続し、座標と線の表現は `coordinates.ts` に隔離する。ただし、下記の単一ローカル実測は表示環境と待機時RAF基準値が未記録であり、200枚操作の性能条件は満たしたと判断しない。製品導入時には profiling、viewport 外のノードの描画省略・virtualization、カードの複雑さを含む追加検証を行い、その結果が不十分なら代替基盤を再評価する。ペン専用の実装・モード切替が必要という費用は残る。消しゴム、筆圧、選択した線の編集、undo/redo が必要になった時点で UX を再評価する。

`VisualStroke.kind = decoration` の線は装飾であり、Semantic Relation / Dataflow Connection ではない。カードに描いた線もボード上の世界座標に残る。カード移動・リサイズに線を追従させる意味付けは行わない。確認用のシアン破線だけは最初のカードの位置・実測サイズから作る独立した輪郭で、カードとのずれを目視確認できる。

## 実装境界と安全性

- `apps/web/canvas-spike.html` と `src/canvas-spike/`、専用 `vite.canvas-spike.config.ts`。製品 App の route / API / WebSocket / domain / persistence は接続しない。開発・preview は既定 `127.0.0.1:4174` のみ。
- `@xyflow/react` 12.12.0 / `react-markdown` 10.1.0 を catalog で固定する。React Flow のパッケージは MIT。tldraw は依存に加えない。
- 入力は `screen = boardClientOrigin + viewportTranslation + world * zoom` の逆変換で世界座標に変換する。DOM の client rect と pointer の client 座標を使用し、ページスクロールを二重加算しない。SVG は同じ viewport の portal に描く。portal 自体を z-index 1001 にし、この実験の選択カードの既定 elevation 1000 より前面に置く。SVG 子要素だけの z-index では選択カードを越えられない。portal と SVG は pointer-events: none を維持し、別のペン入力面は renderer 全体より前面に置く。単位は UI の CSS px であり科学量ではない。
- ペンモードではカード操作の上に入力面を置き、pointer capture を使用する。pointercancel / lost capture は未完成線を破棄する。完了線は最大100本、1線2,000点。pointermove はRAF単位に間引き、上限後の点を追加しない。ツール切替による unmount は未完成線と予約RAFを破棄する。
- Markdown は見出し・段落・強調・リスト・コード等の許可した要素だけを表示する。HTML は skip、画像とリンクを許可しない。raw HTML / HTML plugin / `dangerouslySetInnerHTML` を使用しない。画像の自動リモートアクセスやリンク実行をさせない。これは軽量カード検証用の制限で、製品の仕様確定ではない。
- Synthetic ラベルをすべての合成カードと画面に表示する。研究データ、AI 出力、出典・承認・保存の代用として扱わない。再読込で破棄する。

## 200枚の計測条件と読み方

200枚を10列の固定グリッドに生成する。各カード初期サイズ260×180、間隔300×220、軽量 Markdown のみ。`onlyRenderVisibleElements=false` で200個のノードを DOM に保持する。チャート、画像、数式レンダラー、API、保存処理、AIは含めない。

「5秒計測」は200枚を再生成し、zoom 0.35、viewport (30,30) に戻す。commit 後に二つの RAF を待ってから5秒で x−600、y−900 CSS pxの自動パンを行う。開始直後のロード時間は除外する。RAF callback の timestamp 差分を採取し、サンプル数、実経過ms、nearest-rank p50 / p95、32ms超の区間数を表示する。空の計測値は未計測で、0や推定FPSで埋めない。入力操作、非表示化は中止として表示する。

これは **RAFの呼出間隔** であり、React commit / GPU render の所要時間やメモリ使用量ではない。ブラウザ、画面リフレッシュレート、ウィンドウサイズ、電源状態、他プロセス、DevToolsの有無に依存する。メモリは未計測。1回の値を安定性能保証に使わない。手動ドラッグ・ホイール・リサイズ中の感触は別に記録し、自動パンの値と混同しない。

### 2026-10-27 の実ブラウザ記録

独立 preview build を Chrome で操作し、保存した[スクリーンショットと検証記録](../evidence/24-canvas-overlay/README.md)を確認した。記録条件は desktop 1800×873 CSS px / dark。Chrome の正確な version、OS、キャッシュ状態、画面の refresh rate、電源状態は未記録。light / mobile はこの記録の対象外。

| 項目 | 単一ローカル実行の観測 |
|---|---:|
| 合成カード数 / 実 DOM ノード数 | 200 / 200 |
| 自動パン完了時 viewport x / y / zoom | −570 / −870 / 0.35 |
| RAF 間隔サンプル数 | 139 |
| 実経過時間 | 5054.20 ms |
| RAF 間隔 p50 / p95 | 33.30 / 67.60 ms |
| 32 ms 超の間隔数 | 82 |

p50 の33.30 msは30 Hzの呼出間隔とも整合する。画面のrefresh rate、電源・省電力状態、操作環境と、計測前の待機時RAF基準値が未記録のため、この結果だけでは通常の30 Hz cadenceと描画処理による遅延・引っかかりを区別できない。32 ms超の82区間も固定閾値に対する計数であり、環境に対する欠落フレーム数ではない。**200枚で60fpsを達成した、または本番性能を受け入れたという結果ではない。** 座標同期の確認と性能の採否を分ける。上記条件での一回の結果から React Flow 自体の限界や他基盤への優劣も断定しない。profiling と描画対象の絞り込み後、製品相当のカードと複数の画面・環境で再計測する。

portal の前面化後に、カード上のピンク線とシアン輪郭が見え、pan / zoom 後も相対位置が一致することを目視確認した。同じ修正後 build でタイトル drag と corner resize を確認し、カード client bounds は left=100 / top=308.75 / width=255 / height=184.5、SVG 輪郭は left=100.00025177 / top=308.75024414 / width=255 / height=184.5 CSS px だった。この一例の subpixel 差は0.0003 CSS px未満であり、全操作・全zoomの誤差上限ではない。線は入力を遮らず操作できた。

1800×873 の観測でページの横はみ出しはなく、warning / error の console 取得（上限12件）は空だった。未観測の時間帯・画面条件までエラー不在を保証しない。純粋関数・SSR・Happy DOM テストを実ブラウザの描画性能の証拠にはしない。

## tldraw ライセンスの確認メモ

2026-10-27 に [tldraw公式ライセンス説明](https://tldraw.dev/community/license)を確認した。既定の SDK ライセンスは開発利用を対象とし、production は trial / commercial / hobby のいずれかの有効なライセンスキーを要する。non-commercial 向け hobby は裁量で発行される方式で、watermark 表示条件がある。同ページは SDK を permissive OSS とは扱っていない。例示コードの MIT と SDK 本体の条件を混同しない。

大学・研究室利用で自動的に無条件の本番利用が認められるとの記載としては扱わない。組織・用途・公開形態・共同研究先等に照らした適用は個別確認事項。これは公式説明の技術選定メモであり、契約の適用判断や法的な保証ではない。今回 tldraw を使わず、React Flow の継続条件が崩れた場合に改めて SDK 条件と UX を比較する。

## 再現と検証

```sh
pnpm install --frozen-lockfile
vp check
vp test
vp build
vp run -r build
vp run --filter ./apps/web spike:canvas:build
vp run --filter ./apps/web spike:canvas
# build済みのpreviewを確認する場合（devと同時には同じportで起動しない）:
# vp run --filter ./apps/web spike:canvas:preview
```

`http://127.0.0.1:4174/canvas-spike.html` を開く。12枚で先頭カードとシアン輪郭を確認し、タイトルをdrag、コーナーresize、zoom、panを行う。ペンでカードの角をなぞり、ナビゲーションへ戻ってpan / zoomし、線と世界座標の一致を確認する（その後カードを動かした場合、装飾線は世界座標に残る）。200枚→全体表示で合成カード数を確認し、5秒計測を実行する。

純粋関数テストは page/board offset・pan・0.08〜2倍zoomの往復変換、元の世界座標の維持、特異・非有限入力の拒否、移動・resize後の輪郭、RAF集計と欠損を確認する。SSRテストは Markdown の有効な部分集合と raw HTML / script / onerror / image / link の非生成を確認する。Happy DOM では実 React Flow の DOM と実スタイルシートで portal が選択カードより前面の z-index を持つこと、線が入力を遮らないこと、ペン入力面が renderer より前面にありナビゲーション復帰で除去されることを検証する。ラスタライズした重なり、座標の目視一致、実FPSやメモリはこのテストの対象ではない。

## 公式資料

- [ViewportPortal](https://reactflow.dev/api-reference/components/viewport-portal)、[NodeResizer](https://reactflow.dev/api-reference/components/node-resizer)、[ReactFlowInstance](https://reactflow.dev/api-reference/types/react-flow-instance)
- [React Flow performance](https://reactflow.dev/learn/advanced-use/performance)、[xyflow MIT license](https://github.com/xyflow/xyflow/blob/main/LICENSE)
- [react-markdown security](https://github.com/remarkjs/react-markdown#security)
- [tldraw license](https://tldraw.dev/community/license)、[SDK license text](https://github.com/tldraw/tldraw/blob/main/LICENSE.md)

ペンモード中は入力面が wheel を受けるため zoom は行わない。pan / zoom は選択・パンモードへ戻して行う。集計 helper は非有限・負の入力間隔を除外する防御を持つが、実 RAF の測定経路では browser timestamp の差だけを使用する。除外数の表示は未実装であり、科学データのフィルタリング用途には使用しない。
