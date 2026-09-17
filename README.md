# なめらかボスコニアン風見下ろしシューティングゲーム

Webブラウザで動作する、スムーズな自機移動と弾発射ができるボスコニアン風STGです。

## 主な仕様
- 全方位なめらか移動（8方向、スクロール対応）
- 弾発射（前方・後方ショット）
- 複数の敵基地（破壊可能）
- シンプルな敵出現
- Jev向けの構造化観測・時間制限付き操作コネクター
- ゲーム外のエージェント作業にも流用できるJSONL実行ログ

## 操作方法
- 矢印キー / WASD：移動
- スペースキー：弾発射

## 実行方法

`index.html` をブラウザで開いてください。

## Jev Connector

通常プレイには影響しません。URLへ `?jev=1` を付けた場合だけ、ゲーム画面の下にJev用パネルが表示されます。

```text
https://kg-ninja.github.io/bosconian_like_smooth_shooter/?jev=1
```

コネクターは現在フレームのステージ、残り基地、自機、最寄り基地、脅威をJSONで10Hz配信します。未来の出現や乱数結果は含めません。

Action JSON:

```json
{
  "movement": "up_right",
  "fire": true,
  "duration_ms": 300,
  "move_ms": 300
}
```

- `movement`: `stay`, `up`, `down`, `left`, `right`, `up_left`, `up_right`, `down_left`, `down_right`
- `duration_ms`: 50〜3000ms
- `move_ms`: 0〜`duration_ms`
- `fire: true`: 操作時間中に連射用のキーパルスを生成
- 期限切れ、GAME OVER、ステージ遷移、タブ非表示、フォーカス喪失時に入力を解除

ブラウザ内の外部ハーネスからは次のAPIも利用できます。

```js
window.JevBosconianConnector.observe();
window.JevBosconianConnector.act({
  movement: 'right',
  fire: true,
  duration_ms: 150,
  move_ms: 150
});
window.JevBosconianConnector.stop();
window.JevBosconianConnector.getLog();
window.JevBosconianConnector.getLogJSONL();
```

同一ウィンドウの `postMessage` では `type: "jev-bosconian-action"` を受け付けます。

## 汎用Agent実行ログ

`agent-execution-log.js` はゲーム固有ではないロガーです。調査、ブラウザ操作、API検証、決済前後の確認などでも同じ形式を利用できます。

保存対象：

- セッションの目的と実行元
- 状態変化
- 判断と操作
- 操作結果
- 成功・失敗・未確認事項
- 1Hzへ間引いた観測サンプル

10Hzの観測全文は保存せず、再利用価値の高い出来事を中心に記録します。ログはブラウザのローカル領域だけへ保存され、自動送信されません。最大12セッション、各1500イベントまで保持します。

```js
const session = window.KGAgentExecutionLog.createSession({
  task: { domain: 'research', objective: '公開情報を再確認する' },
  source: { application: 'kg-voice' }
});

window.KGAgentExecutionLog.record(session.session_id, {
  kind: 'action',
  actor: 'agent',
  data: { operation: 'open_source' },
  evidence: { url: 'https://example.com/' }
});

const jsonl = window.KGAgentExecutionLog.toJSONL(session.session_id);
```

各行は `agent-execution-log.schema.json` のセッションまたはイベント形式です。Jevパネルから現在セッションをコピーまたはJSONLファイルとして保存できます。

---

ご要望があれば、敵AIや演出なども追加可能です。
