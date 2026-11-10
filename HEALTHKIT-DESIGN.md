# AWログ：身体測定・HealthKit連携設計 v1

## 今回の対象

体重画面と、連携アダプターからデータを受け取るモデルまで。公開サイトへのデプロイ、iOSアプリ、HealthKit権限要求・実データの取得は今回の対象外。

体重画面：最新体重・測定日時・記録元、前回測定との差、30日／90日／全期間のグラフと履歴、手入力の追加／編集／削除、独立したJSONバックアップ。比較は直前の測定との差で、日平均や減量評価ではない。グラフは同日複数の測定も表示し、欠測値を0として補わない。

## 保存モデル

localStorageキー `awl-health-v1`。トレーニングの保存領域とは独立。構造は `{version:1, observations:[], sync:{healthkit:{anchor:null,lastSyncedAt:null}}}`。

各観測：`{id,metric,value,unit,measuredAt,updatedAt,source:{kind,recordId}}`。

- metric：bodyMass（kg）、将来拡張用にbodyFatPercentage（%）も検証可能。体脂肪率の画面・同期は未実装。
- measuredAt：タイムゾーン付きISO日時。表示は閲覧端末のローカル時刻。手入力は端末時刻からUTCへ変換。
- updatedAt：アダプターで取り込んだ日時、または手入力の更新日時。HealthKit自体の更新日時という意味ではない。
- id：manual:<UUID> または healthkit:<HealthKit sample UUID>。日付・値の一致で統合しない。同一測定が手入力とヘルスケアの両方に存在する場合は別記録として表示。
- source.kind：manual / healthkit。recordIdは各ソースで安定したID。HealthKit由来の記録は元アプリ側で管理する。

## ネイティブ側との契約

`AWLHealth.create(storage).applyHealthKitBatch(batch)` がテスト済みの受け取り口。Webから権限要求する関数や外部公開APIは設けない。iPhoneアプリ化の際に、信頼するアダプターと画面更新処理を接続する。

バッチ例：

```json
{
  "version": 1,
  "metric": "bodyMass",
  "previousAnchor": null,
  "anchor": "opaque-next-anchor",
  "syncedAt": "2026-11-10T10:00:00Z",
  "upserts": [{
    "id": "healthkit:sample-uuid",
    "metric": "bodyMass",
    "value": 65.5,
    "unit": "kg",
    "measuredAt": "2026-11-10T07:00:00+09:00",
    "updatedAt": "2026-11-10T10:00:00Z",
    "source": {"kind": "healthkit", "recordId": "sample-uuid"}
  }],
  "deletedRecordIds": []
}
```

1. iOSでbodyMassの読み取り許可を要求する。書き込み権限は初期対象外。
2. HKAnchoredObjectQueryの追加・削除を取得し、kgへ正規化。アンカーはネイティブがエンコードする不透明文字列。
3. UUIDでupsertし、削除UUIDはhealthkit由来の記録だけに適用する。
4. バッチ全体を検証し、観測と次のアンカーを一緒に保存する。保存に失敗したらメモリーとアンカーを進めない。
5. previousAnchorが現在と一致しない古い／順序の違うバッチは拒否する。現在のアンカーから再取得すれば同じUUIDは増えない。

アンカーは同一端末・同一HealthKitストア・同一クエリー条件専用。別端末へのバックアップ復元時は、ネイティブ側で保存アンカーを破棄して初回取得し直す設計とする（端末識別・リセット操作はネイティブ実装時に追加）。

## 権限と欠測

現画面は常に「未連携（準備中）」と表示。データがないことから権限拒否を推定しない。今後は接続環境の有無、照会中、照会完了、エラーを別に管理し、照会が空だった場合は「読み取れる記録なし」とする。権限の取り消しを理由に既に保存したデータを勝手に削除しない。

## データ保護と制限

保存失敗は入力と既存データを保持。読み込み不能の保存データは上書きを止める。正常なデータに対するバックアップ復元は全件置換し確認する。壊れた保存領域の復旧UIは未実装。

体重データはAI相談・トレーニング用JSONには自動で含めない。クラウド同期なし。ネイティブ移行ではアプリ側ストレージ、端末変更、Web版からの移行、権限の説明とプライバシーポリシーを別途実装・検証する。

参照：
- https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/bodymass
- https://developer.apple.com/documentation/healthkit/hkanchoredobjectquery
- https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data