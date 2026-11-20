# Cloudflare Workers AI / Neurons 利用量調査ログ（2026-11-19）

## 目的
チャッピー本体とは切り離して、Cloudflare Workers AIを記憶処理用AIの候補として調査する。無料枠内で継続利用できるか、Neurons消費量、M（お母さんの記憶）/C（チャッピーのプロフィール）の分類精度、日本語会話品質を確認する。

**重要な安全境界**
- 今回は独立した調査のみ。チャッピーのHTML、Worker、D1、Pages、本番環境には変更を加えない。
- AI推論はまだ一度も実行していない。Neurons消費を伴うモデルテストは、無料枠・費用・上限超過時の挙動を確認し、ユーザーが明示的に了承するまで実行しない。
- 有料プランへの変更、カード登録、従量課金、課金への自動切替は行わない。
- APIトークン、Account ID、パスワード等の秘密情報をGitHubやチャットへ記録しない。

## 2026-11-18〜19の作業記録

### Cloudflareプラン・トークン
- Cloudflare Workers Free が有効であることをユーザー画面で確認。
- Workers Paid は未契約、支払い方法は登録されていない状態をユーザー画面で確認。
- アカウント用APIトークンを作成。名前：`Chappy-Neurons-ReadOnly`。
- 有効期限：2026-12-18（30日）。
- 権限：Account Analytics Read のみ。アカウント単位。その他の権限は付与していない。
- トークンはユーザーがPowerShellへ非表示入力し、チャットやGitHubには共有していない。
- 正しいアカウントトークン検証先 `/accounts/{account_id}/tokens/verify` で `status=active` を確認。最初に誤ってUser Token用検証先を使い401になったが、その後正しい検証先で成功。
- Account IDの長さ32文字はPowerShell内で確認。値そのものは保存しない。

### PowerShellの状態・操作
- PowerShellでトークンを `$CF_TOKEN`、認証ヘッダーを `$headers`、Account IDを `$CF_ACCOUNT_ID` に設定。
- `$headers.GetType().FullName` は `System.Collections.Hashtable`。
- `$body.GetType().FullName` は `System.String`。
- `$body` の内容は次のGraphQL introspection query文字列であることを確認：
  `{"query":"{ __type(name: \"Query\") { fields { name type { name kind ofType { name kind ofType { name kind } } } } } }"}`
- PowerShellセッションは最後まで閉じていない。次回、変数が残っている可能性はあるが、セッションを閉じた場合はトークンを安全に再入力する。
- 先に `Write-Host "準備OK"` が正常に実行された。

### GraphQL調査・未解決エラー
- GraphQL API endpointとして `https://api.cloudflare.com/client/v4/graphql` を使用する想定。
- 最初の `__type(name: "Account")` introspectionでは、返却が `data.__type = null`、`errors = null`。この結果だけではAccount型が利用可能か判断できない。
- 次に `__type(name: "Query")` を調べるコマンドを実行したが、`Invoke-RestMethod` が次のエラーで失敗：
  `'System.String' の型にパラメーターなしのコンストラクターは定義されていません。`
- エラー後に `$r.errors` は空だったが、これは前回リクエストの古い `$r` が残っていた可能性があるため、新しいリクエスト成功の証拠にしてはいけない。
- `$body` は正しいJSON文字列として表示された。ヘッダーはHashtable、本文はStringであり、型だけでは失敗原因を特定できていない。
- 次回はPowerShellの送信処理を安全に切り分ける。リクエスト失敗時に古い `$r` を新しい結果と誤認しないよう、送信直前に `$r = $null` とし、例外を明示的に捕捉するなどの方法を検討する。トークンやAccount IDを表示しないこと。
- GraphQL schema field/dataset名はまだ実データで確認できていない。以前の会話で `aiInferenceAdaptiveGroups` / `totalNeurons` という候補が出たが、実スキーマで確認するまでは確定事項として扱わない。
- Neurons Analyticsがサンプリング/推定値を返す可能性があるため、結果が得られても請求用の正確な残量・正確な個別リクエスト消費と同一視しない。公式説明とデータ粒度を別途確認する。

## 現時点の結論
- APIトークン認証：成功確認済み。
- GraphQLのAnalytics query：未成功。スキーマ・データセット・フィールド名は未確定。
- AI推論：0回。Workers AI Neurons消費：この調査での推論消費は0。
- チャッピー本体、Worker、D1、GitHubのアプリコード：変更なし。
- 課金プラン変更・カード登録：なし。

## 次回の再開手順（2026-11-19）
1. まず公式Cloudflare GraphQL Analytics schema/docsで、対象datasetとfield名、filter、時刻粒度を確認する。曖昧なまま推測でコマンドを作らない。
2. PowerShellの `Invoke-RestMethod` エラーを最小の読み取り専用リクエストで切り分ける。変数の型だけで原因を断定しない。
3. 送信成功を確認してから、Analytics schema/introspectionを取得する。前回の古い `$r` を結果として使わない。
4. 正しいdataset/fieldが確認できた後、短い過去期間のNeurons集計を読み取る。AI推論はまだ実行しない。
5. 無料枠・上限到達時の挙動・モデルごとのNeurons単価/消費情報を公式情報で照合する。
6. ここまでの条件が明確になり、ユーザーが明示的に承認した場合に限り、別途モデル品質テストを計画する。テスト内容・想定消費・上限を先に説明する。

## 次の担当者への注意
- ユーザーはプログラミング初心者。日本語で短く、操作は一度に一つだけ案内し、実行前に何をするコマンドか説明する。
- ユーザーの作業時間には制限がある。遠回りの試行や未検証コマンドを連続して提示しない。
- PowerShellの複数行貼り付け警告は貼り付け時の安全確認であり、Cloudflareの警告ではない。コマンド内容を確認したうえで案内する。
- 秘密情報は画面共有・チャット・GitHubに出さない。エラー共有時もトークン、Account ID、Authorization headerを必ず伏せる。
- 「まだAI推論をしていない」「Neuronsを消費していない」という状態を維持する。無料/無課金条件が確認できるまで推論を実行しない。


## 2026-11-20 追記：後続のGLM-4.7-Flash品質テストとの時系列整理
このNeurons調査ログにある「AI推論0回」は、当該利用量調査の時点での状態を示す。過去会話の確認により、その後GLM-4.7-Flashによる記憶抽出品質テストTest 1〜5が実施された記録が見つかった。したがって、この記述を11月19日の全作業期間を通した最終結果として扱わないこと。復元できた合否・Neurons値は `MEMORY_EXTRACTION_TEST_RESULTS_2026-11-19.md` に整理した。元の完全なプロンプト・生出力・一部使用量は未回収であり、推測で補っていない。
