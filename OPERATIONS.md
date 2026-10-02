# AIを使わない日次運用

公開先: https://longchanp7-hub.github.io/sushi-fair-app/

既存の `.github/workflows/update-fairs.yml` を毎日06:17 JST頃に実行します。別の日次スケジュールは追加しません。公式ページ取得→既存のチェーン別パーサー→品質ゲート→差分commit→Pages公開→公開確認を通常のNodeスクリプトで行います。Work/CodexやLLM、有料APIは呼びません。肉アプリとは独立しています。

- 収集元: `scripts/source-registry.mjs`、各チェーンの既存収集スクリプト
- 公開URL・軽量検査: `operations.json` / `scripts/ops-health.mjs`
- 品質ゲート: `scripts/quality-gate.mjs`（壊れた候補を隔離し、有効な前回データを維持。前回も無効なら公開前に失敗）
- 時刻変更: `.github/workflows/update-fairs.yml` のschedule（UTC）

取得失敗やHTML変更を成功扱いで推測補完しません。品質・取得結果はActionsのログ/summaryに記録します。未知の不具合は人による修正が必要です。該当workflowを再実行すれば有限のリトライで再取得できます。

公開データ差分がないschedule実行はdeployを省きます。確認時刻や鮮度の状態が変わる場合も正当なデータ差分です。UI変更pushや明示Run workflowは公開します。品質/coverageのartifactは3日、Pages artifactは標準の短期保存です。標準Ubuntu runnerを利用し、large runnerや課金APIへの切替はしません。GitHubの条件: https://docs.github.com/en/billing/concepts/product-billing/github-actions

通常チャットで「寿司アプリの収集元/対象地域/表示を○○へ変更、既存品質ゲートを維持し検証して公開」と依頼できます。編集可能な設定を通じた修正であり、アプリ内で自然言語をLLMへ送信する機能ではありません。変更作業にAIを使う際の枠と、AIを起動しない日次処理は別です。

GitHub側のスケジュール遅延・停止はActions画面で確認します。ChatGPT上の同名会話は稼働中のAIスケジュールの証拠ではありません。別途正規ログインで一覧確認可能になった場合のみ、関係する定期タスクの有無を確認してください。
