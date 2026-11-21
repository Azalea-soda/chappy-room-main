# 2026-11-22 セッション進捗：テスト環境の接続先確認

対象リポジトリ：`Azalea-soda/chappy-room-main`
対象ブランチ：`memory-admin-v1`
確認日：2026-11-22（JST）

## 確認済み事項

### 1. Cloudflare Worker
ユーザーがCloudflare画面で確認した内容：
- Worker名：`chappy-memory-admin-test`
- Active/latest version：`d10e734f`
- Status：Active
- ブランチ表示：`memory-admin-v1`
- デプロイ日時：`2026-11-21 23:20:09 JST`（`2026-11-21T14:20:09.140Z`）

この画面上の稼働版を確認済み。version IDをクリックするとMethod Not Allowedになったため、以後そのIDはクリックしない。GitHubソースSHAとの完全一致は未確認。

### 2. Cloudflare Pages
ユーザーがCloudflare Pages画面で確認した内容：
- Pages project：`chappy-memory-admin-test`
- Pages URL：`https://chappy-memory-admin-test.pages.dev`
- Deployment-specific URL：`https://886fdda1.chappy-memory-admin-test.pages.dev`
- Deployment ID：`886fdda1-d5b0-424b-92c2-ee38cf79d305`
- 表示環境：Pagesプロジェクト内のProduction
- ブランチ表示：`memory-admin-v1`
- デプロイ名／コミットメッセージ表示：`Record route comparison completion and next step`
- Details画面の表示時刻：ユーザー確認時点で「33 minutes ago」
- Build logsにinitialize / clone repo / build / deployの各段階が表示された。

GitHub branch APIで確認した `memory-admin-v1` HEAD：
- Commit：`aa277523c374b96a64bb668e7b9fec0fc9e5ea20`
- Message：`Record route comparison completion and next step`
- Commit時刻：`2026-11-21T14:19:20Z`（23:19:20 JST）

Workerのデプロイ時刻（23:20:09 JST）とGitHub HEADのコミット時刻（23:19:20 JST）は近接し、Pagesの表示メッセージも一致している。ただしPagesのDeployment画面からCommit SHAそのものは取得できていないため、PagesデプロイがこのSHAと完全一致するとの断定はしない。PagesのBuild output directory設定値も今回の画面確認では確定できていない。

### 3. WorkerのD1バインディング（今回ユーザーが直接確認）
Cloudflare WorkerのSettings > Bindingsで以下を確認：
- Binding name：`DB`
- 接続先データベース名：`chappy-memory-test`
- Database ID：`fd96a54a-d13e-4c8f-bc62-7afffea55182`

これは予定していたテスト用D1の名前・IDと完全一致。今回の確認で、WorkerのDBバインディング先がテスト用D1であることを確認できた。

## 結論と再調査防止
- Workerはテスト用プロジェクト名・開発ブランチ表示・Active versionを確認済み。
- Pagesはテスト用プロジェクト名・URL・開発ブランチ表示を確認済み。
- WorkerのDBバインディングはテスト用D1の名前とIDまで一致確認済み。
- **この一連のCloudflare画面確認を、次回以降もう一度最初からユーザーにやらせない。** ここに記載した内容を確定済みの調査結果として引き継ぐ。
- PagesのCommit SHA/output directory、WorkerのGitHub SHAとの厳密な一致など、残る細部は未確認事項として扱う。ただし、それらを理由に同じ基本画面を再確認させない。必要性が具体的に生じた場合に限り、可能ならGitHub/API等の読み取りで解決する。
- この記録だけを根拠に「本番から全経路が完全隔離された」と断定しない。確認できたのは上記のWorker・Pagesプロジェクト／ブランチ表示とD1バインディングである。

## 作業内容・安全境界
今回行ったのはCloudflare画面の読み取り確認とGitHubの読み取りのみ。設定変更、D1への書き込み、Worker/Pagesのデプロイ、mainへの変更・マージは行っていない。
次の作業は、同じ環境確認を繰り返すことではなく、既存の記憶抽出テスト結果・現行Workerソースを踏まえて、会話応答を妨げない記憶抽出・保存フローの設計／実装準備へ進むこと。


## 2026-11-22 追加確認：Pages画面とWorker接続先の分離チェック

GitHubの `memory-admin-v1` ブランチから以下のファイルを読み取り確認した（設定変更なし）。

### 1. Pagesの会話画面 `preview/index.html`
- ファイルSHA：`b606676a9b6e9e8adfd3cf5e6699894e7d1df3fc`
- 242行目の `API_URL` は `https://super-violet-bc7e.nanami-moca.workers.dev`。
- このURLは既存記録上の本番会話Worker。
- D1読み込み（/fixed-rules、/memories、/chappy-profile）および会話（/chat）がこの `API_URL` を使う。
- よって、Pagesの検証用会話画面からのAPI通信先は本番Workerであり、**会話画面の通信経路はテスト用Workerへ分離されていない**。テストPagesで会話すると本番Workerへアクセスする構成になっている。
- Voice URLは `https://chappy-voicevox-test.nanami-moca.workers.dev/speak`（テスト用VOICEVOX Worker）。音声生成先はテスト用だが、会話・D1 API先が本番Workerである問題は解消しない。

### 2. Pagesの管理画面 `preview/admin.html`
- ファイルSHA：`94d5ed08088fbfe27fc9b378f179d4d499c6a3e2`
- 115行目の `API_URL` は `https://chappy-memory-admin-test.nanami-moca.workers.dev`。
- 管理画面はテスト専用Workerを指定している。ファイル内コメントにも本番Workerを指定しない旨がある。
- したがって、管理画面のAPI接続先はテスト用Worker。

### 3. Worker設定 `wrangler.toml`
- ファイルSHA：`42998f912c34237111e01bd965d89592b56a226c`
- Worker名：`chappy-memory-admin-test`
- D1 binding：`DB`
- database_name：`chappy-memory-test`
- database_id：`fd96a54a-d13e-4c8f-bc62-7afffea55182`
- Cloudflare画面でユーザーが確認した実バインディング名・DB名・IDと一致。

### 4. 最終判定
- Pagesプロジェクト／ブランチ、Workerプロジェクト／ブランチ、WorkerのD1接続先、管理画面のWorker URLはテスト用として確認できた。
- しかし、Pages会話画面 `preview/index.html` の `API_URL` が本番会話Workerを指しているため、**テスト環境と本番環境は全経路で分離されていない。現状のままPagesの会話画面をテストに使わないこと。**
- 次に必要な修正候補は、`preview/index.html` の `API_URL` をテスト専用Worker `https://chappy-memory-admin-test.nanami-moca.workers.dev` に向けること。ただし、これは現時点では提案であり、ファイル変更・Pages再デプロイはまだ実施していない。
- 修正前に、テストWorkerの端末登録（/enroll）と会話（/chat）に必要な設定・秘密情報・CORS・D1テーブルが揃っているかをソースで確認する。必要なら `setup.html` 等の接続先も確認し、テスト用端末登録から会話までの経路を一貫してテスト用にする。main/index.htmlは本番用として変更しない。
- PagesのBuild output directory設定値とPagesデプロイCommit SHAはCloudflare画面から確定できていない。これらは未確認のまま記録し、今回の確認を繰り返す目的でユーザーに同じ画面を再確認させない。

この追加調査もGitHubファイルの読み取りのみ。ファイル変更、D1書き込み、Cloudflare設定変更、デプロイ、mainへの変更・マージは行っていない。
