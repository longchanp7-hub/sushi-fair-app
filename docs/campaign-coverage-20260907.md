# PR #47: 2026-09-07 公式告知の収録漏れ対策

## 背景と対象

かっぱ寿司の9月16日「トロの日」、徳兵衛の秋スイーツ・平日ランチ・持ち帰り祭り・シニアパスポートが、既存データ品質ゲートでは検出されなかった。

「生成済みデータの整合性」と「公式告知の収録範囲」は別。前回の基盤改修完了は全告知の網羅性まで保証するものではなかった。

今回、新しい告知一覧照合を導入するのは **かっぱ寿司・にぎりの徳兵衛の2チェーン**。既存8チェーンの主フェア品質チェックは維持する。8チェーン全告知の完全取得、画像内商品・価格の完全抽出、自動ロールバックは完了対象ではない。

## 実装

- `app/campaign-catalog.js`: 現行・近日開始を分類表示。開始予定、店内／持ち帰り、平日ランチ、優待などを区別し、将来の特価を主フェア商品価格に混ぜない。
- `scripts/campaign-catalog.mjs`: 公式告知一覧のリンクから毎回発見する。日付・フェア名を本番用の固定リストで補う方式ではない。
- かっぱ寿司: 公式キャンペーン一覧と企業公式PR TIMES RSS。JavaScriptだけの企業リリース一覧ページは使用しない。
- 徳兵衛: 公式トップページと公式お知らせ一覧の個別ページ。
- `campaignCatalog` を既存 `items` / `campaigns` と分離。主フェア用の旧 `isActive()` / 固定補正処理を無理に変更せず、その後の独立した収録処理で予告と並行告知を取得する。
- 同じ `/menu2` に向かう複数バナーを別告知として保持。共通メニューページの商品をすべて特定フェアの商品に割り当てない。
- 画像などで商品を読めない場合も告知は保持し、`itemStatus=unavailable` と表示。0件を商品なし・販売終了とは扱わない。
- `scripts/verify-campaign-publication.mjs`: 独立して保存した期待URL・告知ID集合と最終データを照合。公開後はカタログの内容と3つの配信JSを作成した成果物と一致確認する。
- `app/national.js`: 同じJSONから主フェアと関連告知を表示。開始日・終了日は日本時間で再判定し、日付をまたいで画面を開いていても更新する。
- `app/sw.js`: 新しい表示モジュールを事前キャッシュ。

## 対象範囲・不確実性

- 近日開始は45日先まで。
- RSSの通常走査は公表日から90日以内。既知の継続告知・明示的な現在の実施期間は別途考慮する。
- RSSに `dc:date` と `date` が両方あっても連結せず、一つの有効な公表時刻を使用する。
- 終了日不明の古いプレスリリースを、ページが存在するだけで永続的に「開催中」としない。公表・開始から14日を超え、現在の実施根拠を確定できないものは `current_status_unconfirmed` として通常表示から外し、理由を記録する。これは販売終了の断定ではない。
- 現行公式キャンペーン一覧に残る告知は別の根拠として取得する。新商品の価格や対象店舗は推測で補わない。
- `campaignCoverage.state=complete` は、この対象範囲と除外方針で収録照合が完了したという意味。全公式情報・全商品の網羅性や現在の在庫の保証ではない。過去の未確認告知の件数も画面に注記する。
- 通信失敗では一覧を `partial` とし、直近3日以内の前回情報を使う場合も確認時刻は更新しない。

## 公開経路

`update-fairs.yml` の自動更新に接続:

既存取得・補正 → 主フェア品質ゲート → 独立告知収集 → 期待集合・レンダラー検証 → 既存8チェーン検証 → commit → Pages公開 → 従来smoke → 告知とJSの配信一致検証。

自動のUI更新とデータ更新をこの経路へまとめた。`deploy-pages.yml` はmainの既存成果物を明示的に再公開する手動専用に変更し、ここにも新しい公開前後チェックを残した。同じ変更で古いデータを持った静的デプロイが二重に走ることを防ぐ。

## テストと証跡

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --experimental-vm-modules --test scripts/test-campaign-catalog.mjs scripts/test-campaign-integration.mjs
node scripts/campaign-catalog.mjs --report /tmp/campaign-coverage.json
node scripts/campaign-catalog.mjs --verify --report /tmp/campaign-coverage.json
node scripts/verify-campaign-publication.mjs --local --inventory /tmp/campaign-coverage.json
node scripts/verify-campaign-publication.mjs --url https://longchanp7-hub.github.io/sushi-fair-app/ --inventory /tmp/campaign-coverage.json --report /tmp/campaign-publication.json
```

回帰テストは24条件。1日限定、開始前／当日／翌日、複数告知、税込最低価格、RSSの日付重複、古い終了日不明告知、共通メニューリンク、取得失敗、前回確認時刻、期待ID欠落、不正価格、HTMLエスケープを検証する。実際の `national.js` をVM上のDOM・通信模擬環境で実行し、カード表示・HTTP503・日付切替も検査する。このVM試験は実ブラウザ試験とは区別する。

PRの `Campaign catalog integration` は公式サイトを実取得し、公開しない隔離環境で検証する。アプリ全体と収集証跡は `campaign-catalog-integration` artifact に保存。本番検証証跡は `quality-and-campaign-reports` artifact に保存する。

## 引継ぎ

今後も現在のmainを取得してから修正する。品質ゲートを緩めて成功にするのではなく、欠落・未確認・販売終了を区別する。告知の収録成功を商品・価格の完全取得と報告しない。
