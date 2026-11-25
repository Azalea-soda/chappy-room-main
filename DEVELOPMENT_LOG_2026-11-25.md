# 2026-11-25 作業ログ：Cloudflare GraphQLでWorkers AI Neurons使用量を確認

## 今日の目的
Cloudflare GraphQL Analytics APIを使い、2026-11-19に行ったGLM-4.7-Flashの推論テストについて、Workers AIのNeurons消費量（totalNeurons）を読み取り専用で確認する準備を進める。

無料利用枠の実際の消費量を把握するための調査。AI推論を新たに実行せず、課金設定・トークン・権限・Worker・アプリコードは変更しない。

## 作業対象・環境
- GitHub現行開発リポジトリ：`Azalea-soda/chappy-room-main`
- ブランチ：`main`
- PowerShell：Windows PowerShell 5.1.26100.9444
- Cloudflare GraphQL endpoint：`https://api.cloudflare.com/client/v4/graphql`
- Analytics用クライアント：`$analyticsClient`（Account Analytics Readトークンを設定）
- Workers AI用クライアント：`$client`（Workers AI Readトークンを設定）
- 2つのトークンは別物。今回のGraphQL調査では `$analyticsClient` のみを使用。
- トークン文字列、Account ID、accountTagの実値はログに記載しない。

## 今日確認できたこと

### 1. GraphQLへの接続とスキーマ調査
- `$analyticsClient` からGraphQLへのPOSTが成功し、HTTP 200相当（PowerShell表示 `OK`）を確認済み。
- Queryルートの主要フィールドとして `cost`、`viewer` を確認。
- `viewer` には `accounts`、`budget`、`organizations`、`zones` がある。
- `viewer.accounts` は引数なしで、`[account!]!`（accountオブジェクトのリスト）を返す型であることを確認。
- `account` 型に `accountTag` が存在することを確認。
- GraphQLのイントロスペクション（スキーマ確認）は成功している。これは利用データの読み取り成功を意味しない。

### 2. Workers AIの集計データセット
`account` 型に以下のフィールドがあることを確認。
- `aiInferenceAdaptive`
- `aiInferenceAdaptiveGroups`

今回のNeurons集計対象は `aiInferenceAdaptiveGroups`。

`aiInferenceAdaptiveGroups` の引数：
- `filter`
- `limit`
- `orderBy`

filterの型：
`AccountAiInferenceAdaptiveGroupsFilter_InputObject`

### 3. filterで確認できた主な項目
- `date` / `date_geq` / `date_leq` など日付条件
- `datetime` および時間単位の集計条件
- `modelId` とモデルIDの比較条件
- `neurons` とNeurons値の比較条件
- `requestSource`
- `errorCode`
- `inferenceTimeMs`
- `costMetricName1` / `costMetricName2` / `costMetricValue1` / `costMetricValue2`

今回の目的では、日付を指定する候補として `date_geq` と `date_leq`、モデルを絞る候補として `modelId` が確認できた。

### 4. 集計結果の型とNeurons項目
集計グループ型：
`AccountAiInferenceAdaptiveGroups`

確認できたフィールド：
- `confidence`
- `count`（uint64）
- `dimensions`（AccountAiInferenceAdaptiveGroupsDimensions）
- `sum`（AccountAiInferenceAdaptiveGroupsSum）

`AccountAiInferenceAdaptiveGroupsSum` の項目：
- `totalAudioSeconds`
- `totalCostMetricValue1`
- `totalCostMetricValue2`
- `totalInferenceSteps`
- `totalInferenceTimeMs`
- `totalInputLength`
- `totalInputTokens`
- `totalNeurons`
- `totalOutputTokens`
- `totalProcessedPixels`
- `totalProcessedTiles`
- `totalRequestBytesIn`
- `totalRequestBytesOut`
- `totalTiles`

重要：`totalNeurons` が存在することをスキーマ上で確認できた。実際のNeurons使用量の値はまだ取得できていない。

### 5. dimensionsで確認できた主な項目
`AccountAiInferenceAdaptiveGroupsDimensions` に以下を確認。
- `date`（Date）
- `datetime`（Time）
- `datetimeFifteenMinutes`
- `datetimeFiveMinutes`
- `datetimeHour`
- `datetimeMinute`
- `datetimeSixHours`
- `modelId`
- `modelIsBeta`
- `neurons`
- `requestSource`
- `errorCode`
- `inferenceTimeMs`
- `requestBytesIn` / `requestBytesOut`
- `costMetricName1` / `costMetricName2` / `costMetricValue1` / `costMetricValue2`
- `tag`

### 6. orderByの候補
`AccountAiInferenceAdaptiveGroupsOrderBy` のenum値を確認。
特に今回関係するもの：
- `date_ASC` / `date_DESC`
- `modelId_ASC` / `modelId_DESC`
- `sum_totalNeurons_ASC` / `sum_totalNeurons_DESC`

これにより、日付順・モデル順・Neurons合計順の指定候補を確認できた。

## 今日実行したGraphQL利用データ照会と結果

スキーマ調査を終え、2026-11-19のデータを取得する読み取りクエリを1回送信した。

実行クエリ（トークンやアカウント識別子の実値は含まない）：

```graphql
{
  viewer {
    accounts {
      accountTag
      aiInferenceAdaptiveGroups(
        filter: {
          date_geq: "2026-11-19"
          date_leq: "2026-11-19"
        }
        limit: 100
        orderBy: [date_ASC]
      ) {
        dimensions {
          date
          modelId
        }
        sum {
          totalNeurons
        }
      }
    }
  }
}
```

返却結果：

```json
{
  "data": null,
  "errors": [
    {
      "message": "not authorized for that account",
      "path": null,
      "extensions": {
        "code": "authz",
        "timestamp": "2026-11-25T15:18:11.038291613Z",
        "ray_id": "a6019fde6ac749f9-SEA"
      }
    }
  ]
}
```

### この結果から言えること
- GraphQLスキーマのイントロスペクションは成功している。
- 利用データのクエリでは、Cloudflareから `not authorized for that account`（code: `authz`）が返った。
- Neuronsの値は取得できていない。
- このエラーはアカウントへの認可・トークンのアカウント範囲に関係する可能性があるが、原因はまだ確定していない。
- クエリ構文が完全に正しいことも、このエラーだけでは最終確定できない。
- accountTagやアカウントIDの実値をログ・チャットに貼り付けていない。

## PowerShellで確認した変数・出力

### 使用した変数
- `$CF_TOKEN`：Account Analytics Readトークン（値は非表示・非記録）
- `$aiTokenPlain`：Workers AI Readトークン（値は非表示・非記録）
- `$analyticsClient`：`$CF_TOKEN` を使うGraphQL用HttpClient
- `$client`：Workers AI Readトークンを使う別HttpClient。今回のGraphQL照会には使用していない
- `$raw`：account型などのイントロスペクション応答を保持していた変数
- `$schemaRaw`：viewer型のイントロスペクション応答
- `$acctRaw`：account型のフィールド名を取得した応答
- `$usageRaw`：2026-11-19のNeurons照会応答（認可エラーを含む）

### 実行した主な確認コマンド・得られた結果
- `$raw.Contains('"name":"aiInferenceAdaptiveGroups"')` → `True`
- `AccountAiInferenceAdaptiveGroupsSum` のイントロスペクション → `totalNeurons` を含む合計項目一覧を取得
- `AccountAiInferenceAdaptiveGroupsFilter_InputObject` のイントロスペクション → `date_geq`、`date_leq`、`modelId`、`neurons` などを確認
- `AccountAiInferenceAdaptiveGroupsDimensions` のイントロスペクション → `date`、`modelId` などを確認
- `AccountAiInferenceAdaptiveGroupsOrderBy` のenum確認 → `date_ASC`、`sum_totalNeurons_DESC` などを確認
- `$acctRaw` からフィールド名を抽出 → `accountTag` を確認
- `$schemaRaw.IndexOf('"name":"accounts"')` → `137`
- `$schemaRaw.Length` → `531`
- `$schemaRaw.Substring(137)` → `accounts` は引数なしで `account` オブジェクトのリストを返すことが分かる型情報を確認
- `$schemaRaw.Substring(137,500)` は範囲外エラー（ArgumentOutOfRangeException）。原因は残り文字数が500未満だったため。データ破損やトークン問題ではない。
- 途中、PowerShellに `>>` が出たことが2回あった。未完了の入力待ち状態で、Ctrl+Cで `PS>` に戻して復旧。余分な引用符などでコマンドが閉じていなかった可能性がある。
- PowerShell 5.1では、以前から `Invoke-RestMethod` や `ConvertFrom-Json` が環境依存のエラーになったため、今回も `HttpClient` と文字列／正規表現による限定抽出を使った。
- 長いGraphQL応答全文は画面に出さず、必要な項目名や短い部分だけを表示する方針で進めた。

## 実行していないこと・変更していないこと
- 今回の会話中にWorkers AIの推論は一度も実行していない。
- 新しいAPIトークンの作成なし。
- 既存トークンの権限変更なし。
- Cloudflareの課金設定・支払い方法の変更なし。
- Worker、D1、GitHubアプリコード、デプロイの変更なし。
- GitHubへの今回の変更は、この作業ログと次回引き継ぎ書のみ。

## 次回の作業開始地点（優先順）
1. まずCloudflare Dashboardで、現在のAccount Analytics Readトークンの対象アカウント範囲と権限を確認する。トークン値は表示・共有しない。
2. トークンが対象アカウントを含んでいるか確認する。アカウント範囲が不足している可能性があっても、ユーザーの明示承認なしにトークンを作成・変更しない。
3. 必要なら、まず読み取り専用の最小クエリ `viewer { accounts { accountTag } }` で、アカウント一覧の取得が許可されるか確認する。accountTagの値はチャットへ貼らず、ローカルで対象アカウントと照合する。
4. 認可問題が解消してから、2026-11-19の `aiInferenceAdaptiveGroups` を再照会し、`dimensions.date`、`dimensions.modelId`、`sum.totalNeurons` を取得する。
5. 実データのmodelIdがGLM-4.7-Flashに対応するかを確認してから、該当分のNeuronsを集計する。モデルIDの一致を推測で決めない。
6. データが取得できたら、11/19のテスト記録と照合し、Neurons量・推論回数・推論時間を整理する。無料枠の上限や会話可能時間は、確認できた公式条件と実測値を分けて評価する。

## 次回担当者への重要注意
- 今日はスキーマを調べる作業にかなり時間を使った。必要な型名・項目名はこのログに記録済みなので、同じイントロスペクションを最初から繰り返さない。
- 次のボトルネックはGraphQLの型調査ではなく、Cloudflareのアカウント認可エラー `authz` の原因確認。
- まず権限とアカウントスコープを確認し、利用量クエリを何度も試さない。
- ユーザーはPowerShell初心者。長い一行コマンドで `>>` が出る事故を避ける。短いコマンドを一つずつ提示し、実行結果を確認してから次へ進む。
- PowerShell出力にトークン、Account ID、accountTagの実値が含まれないよう注意。長い応答全文を貼らせない。
- 無料枠の安全性確認が終わるまでは、Workers AIの追加推論を行わない。無料枠を使い切った場合の自動再試行は禁止し、上限到達時は停止する方針を維持する。
