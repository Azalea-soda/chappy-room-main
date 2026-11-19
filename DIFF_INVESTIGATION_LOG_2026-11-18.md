# 本番化差分調査・詳細引き継ぎ（2026-11-18）

目的：今回の本番化差分調査を開始した時点からの確認事項を残し、次の担当者が同じ調査を繰り返さず続きから再開できるようにする。

**安全境界：** この文書は調査記録であり本番反映の承認ではない。本番Worker/D1、main、Pagesの変更・デプロイ・マージ・SQL書き込みは今回実施していない。GitHubソースの確認とCloudflare live deploymentの確認は別である。確認済み・未確認・懸念を混同しない。

## 1. リポジトリと参照SHA
Repository: Azalea-soda/chappy-room-main

2026-11-18に取得したbranch heads:
- main: 487c78eecbe80396c14a8aae579a265a91fb7dc6
- memory-admin-v1: cd0d5616f472afd7b7ef731dacdeef73b5f182cd
- voice-stream-queue-v1: ea6348427def6805f81bad6d0767443d074ca311
- voice-stream-queue-v2: 98c2ace5e2343bc96f969f73c82602967621ef73
- chappy-speed-diagnostics: a54bee856bce42887c5e3d0b7eef53a13136e0b5

main:
- index.html SHA e8badb522748e7ece2ba5e13ea7c5160911abcb6 (1009 lines)
- preview/index.html SHA b606676a9b6e9e8adfd3cf5e6699894e7d1df3fc (1275 lines)
- README.md SHA 5a448e0878ed4005ad81378bb3c90ccaf179cc5a
- memory.json SHA c9c1d85d56c0a96583ea0825bd998f6fc354ff74
- setup.html SHA 25a45d28f09b38b5b0fc570fac46b311afab4420

voice-stream-queue-v1/v2 index.htmlは同一blob SHA 4875a96650acbb7f836fafae67c11f0756e24571（1266行）。両方のmemory.jsonもmainと同じSHA c9c1d85d56c0a96583ea0825bd998f6fc354ff74。
v1 workflow SHA f1fb119e26ad94237bf27b2e0281b6385f716852。v2 workflow SHA fa19437fd5ef2529e4957340c411c9078c6176ad。

memory-admin-v1追加ファイル：
- worker.js SHA 1668d0f20883bc377cf7ba777ff52d59eb0557cb（422行）
- preview/admin.html SHA 94d5ed08088fbfe27fc9b378f179d4d499c6a3e2（414行）
- migrations/0001_admin_sessions.sql SHA 064461bdf22e94e4b46101aba18f73898e791d10
- wrangler.toml SHA 42998f912c34237111e01bd965d89592b56a226c
- .github/workflows/worker-syntax.yml SHA bb6fe31e79d0a36c8ff49542f62e4cbc69bcaf5d
- D1_READONLY_CHECK.md SHA 9f8d279404a8b06eadc0f170f207abdfed9811c8
- MEMORY_SYSTEM_PLAN.md SHA d1f4c1d877c0de4999af585a69d6c6bfdd5845a6
- TEST_WORKER_DEPLOY_TRIGGER.md SHA d15927b4b6bf42493a74f71e38e22b5074a8958e

## 2. 調査開始前に得ていた比較結果
- main vs voice-stream-queue-v1: diverged, ahead 16 / behind 5, merge-base dd505e21171dd1b2293083202fefdcb97f8c8809。compare files: workflow +38、index +287/-30、memory.json +27/-27。
- main vs voice-stream-queue-v2: diverged, ahead 5 / behind 3, merge-base 148835cf5d96b137a557983ef5de8eb52ebebe30。workflow +38、index +287/-30。
- v1 vs v2: diverged, ahead 7 / behind 16, merge-base dd505e21171dd1b2293083202fefdcb97f8c8809。workflow/index/memory.jsonの差分表示。
- chappy-speed-diagnostics vs main: mainが9コミット先行、compare files空。speed diagnostics成果がmainへ統合済みという履歴と整合。
注意：compare statsはmerge-base基準。最終コードはblob SHAと内容で確認する。

## 3. 音声差分の詳細

### 重要な訂正
以前「句読点が来るまで待つ」と単純化した説明は誤り。voice-stream-queue-v2には句読点なしでも自然な語尾で早期分割する処理がある。正しくは「句読点に加え、一定の文字数と自然語尾で区切る」。

### main/index.html
- requestChappyAIは530行付近。
- getChappyResponseは626行付近。
- speechChainは643–654行。
- AI deltaをspeechBufferに追加し、正規表現 /[^。！？!?]+[。！？!?]+/g で句読点付き完成文を抽出（665–671行）。
- 文はspeechChainで順番にspeakChappyVoiceへ渡す。
- 最後の残りbufferはAI応答終了時にキューへ入れる（677–680行）。
- speakChappyVoice内に長文を35文字前後で分割し、再生中に次パートを先読みする仕組みがある（約734行以降）。
- よってmainにも次音声の先読みはあるが、AI生成中に自然語尾で早期分割する新方式や独立した音声生成/再生workerとは異なる。

### voice-stream-queue-v2 splitSpeechBuffer
v2 index.html 637–676行:
- [、。！？!?]を検索。
- 。！？!?は候補長に関係なく区切りに採用。
- 、は候補が12文字以上の場合のみ採用。
- 句読点がなければbuffer 28文字以上で自然語尾を探索。
- cut候補は18〜34文字。語尾例：けれども、けれど、けど、ので、のに、だから、ですが、たら、なら、ても、てから、ながら、ですね、ですよ、ます、です、だよ、だね、かな。
- flush=trueなら残りを最後のchunkとして出す。
- AI streamのdelta到着ごとに呼ばれるので句読点だけを待つ仕組みではない。

### voice-stream-queue-v2 speakChappyStream
v2 index.html 683–879行:
- textQueueは分割テキスト、audioQueueは生成済みAudio。
- synthesisWorkerはテキストを1件ずつVOICEVOX WorkerへPOST。
- playbackWorkerは音声を1件ずつ再生。
- VOICEVOX生成は常に1件ずつ、audioQueueの待機音声は最大1件（741–745行）。
- 現在音声再生中に次音声の生成を並行。
- generation IDで古い応答を無効化。
- AbortControllerで音声fetchを中断。
- speechPipelineControls Mapでenqueue/finishText/cancelをgenerationごとに管理。
- cancelは音声fetch abort、currentAudio/prefetchedAudio停止、両workerをwake。
- 生成失敗時はpipeline cancel、再生中/待機中音声を停止し、errorを上位へ返す。
- playback failureもcleanupし、Promise.allSettledで両worker完了を待つ。
- getChappyResponse（881–984行）はAI deltaを画面に追加しながら分割し、すぐ音声queueへ投入。
- 音声pipelineはAI生成と並行開始（900行付近）。全文受信後に残りをflush、finishTextし、音声完了を待つ。
- 音声側失敗時にAI fetchもabort（900–908行）。

### 中断ボタン
v2 index.html 441–474行：
- processing/speaking中にマイク再押下でresponseGenerationを進める。
- pipeline cancel、AIとVoice WorkerのAbortController abort、finishTimer clear、speechSynthesis/currentAudio/prefetchedAudio停止、idle復帰。
既存の青ボタン割り込み動作を守るため統合時に保持する。

### main/preview/index.html
mainには新pipeline本体ではなく独立preview/index.html（SHA b606676a9b6e9e8adfd3cf5e6699894e7d1df3fc、1275行）がある。v2 indexをベースにし、GitHub Pages用に背景/猫/はなまる/マイク画像パスを /chappy-room-main/... に変更。
commit db98020d865c「Fix natural audio end pause handling in preview」でaudio.onpauseを修正：
- cancel中またはgeneration不一致ならfinishしてreturn。
- audio.ended、またはcurrentTimeがdurationの0.25秒以内なら自然終了としてfinish。
- それ以外の途中pauseは失敗。
この修正はmain previewにあり、voice-stream-queue-v2 branch indexには未反映。previewは本体indexとは別ファイルで、本番に自動反映されたわけではない。

### v2 commit history（新しい順）
98c2ace5e234 workflow regex correction
d2eed306eadb workflow JS extraction fix
af19c793c65e run syntax validation
26132a9891cb add JS syntax validation
250d08c2a050 add voice streaming queue
148835cf5d96 restore memory.json recovery backup
f133946835ba remove migrated legacy memory.json
dd505e21171d add Groq SSE and sentence-by-sentence voice playback
11e163a0c3ec add audio buffering diagnostics
f2b8b24e059b add next-part audio preload
26814c3807e4 merge speed diagnostics PR
a54bee856bce fix duplicate audio measurement events
5a8ceb492e8b consolidate audio measurement
0bbedfb86534 add D1 preload and response timing
ce74594f10b4 load Chappy profile/memories from D1
1535b3e5236f improve memory certainty
fb5fc5d1f6aa use only active D1 memories
cdd5ab32abe4 load memories/profile from D1
eb14f294d8a4 device token auth for chat
e03e26e74b5f add device enrollment page
v1 has queue cancellation/cleanup/failure handling commits; final v1/v2 index blobs are identical.

### CI
v1/v2 validate-test-branch.yml uses Node 22, extracts inline JS with Python regex and runs node --check. Trigger branch differs. v2 includes regex correction. GitHub combined-status API returned empty statuses for v1/v2 heads; do not assert CI passed from this result. Syntax check is not device/Worker/D1 runtime proof.

### Audio not yet verified
- ARROWS WE2 real first-audio latency and improvement over ~4 seconds.
- VOICEVOX Worker latency, URL expiry, CORS/cache/concurrency.
- natural chunk quality, short deltas, long answers.
- network interruption/device sleep/audio.load failure recovery.
- firstTextAt is set in v2 getChappyResponse but unused by speakChappyStream.
- whether to bring preview pause fix into production code.
- fallback TTS on actual phone.
- textQueue growth/backpressure if AI is faster than synthesis.

## 4. memory-admin-v1 vs main
Compare base main/head memory-admin-v1:
- diverged, ahead_by 32 / behind_by 1.
- merge-base db98020d865ce2505076a083e96e485b3f1b9d0a.
- compare shows 8 added files only; no existing files modified.
Added: .github/workflows/worker-syntax.yml, D1_READONLY_CHECK.md, MEMORY_SYSTEM_PLAN.md, TEST_WORKER_DEPLOY_TRIGGER.md, migrations/0001_admin_sessions.sql, preview/admin.html, worker.js, wrangler.toml.
Existing main files unchanged by blob SHA: index.html e8badb522748e7ece2ba5e13ea7c5160911abcb6, preview/index.html b606676a9b6e9e8adfd3cf5e6699894e7d1df3fc, setup.html 25a45d28f09b38b5b0fc570fac46b311afab4420, images, memory.json and profile.json. This branch adds memory management files; it does not redesign the existing app.

## 5. memory-admin-v1 Worker

wrangler.toml:
- Worker chappy-memory-admin-test
- D1 binding DB
- database chappy-memory-test
- ID fd96a54a-d13e-4c8f-bc62-7afffea55182
- test Worker URL https://chappy-memory-admin-test.nanami-moca.workers.dev
- test Pages origin https://chappy-memory-admin-test.pages.dev

### CORS/HTTP (worker.js 1–37)
- admin origin exact test Pages origin; wrong/missing Origin gives 403.
- admin CORS restricted to test origin; ordinary app CORS *.
- POST/OPTIONS only; GET 405.
- admin routes independent from device-token auth.

### Admin sessions (worker.js 38–163)
- uses CHAPPY_ADMIN_PASSWORD secret; never put password in frontend.
- compares SHA-256 digests byte-by-byte.
- creates random 32-byte token; stores only SHA-256 hash in D1.
- expiry is 6 hours (line 132); this is latest code and user decision. Old 30-minute docs are stale.
- logout revokes session; admin records require unexpired/unrevoked session.
- admin session and device token are separate.
- existing CHAPPY_ADMIN_PASSWORD is shared with device enrollment. Do not change without explicit discussion.

### Rate limit (worker.js 58–97)
- lazily creates admin_login_attempts.
- hashes CF-Connecting-IP.
- 5 failures in 15-minute window => 15-minute lockout.
- success clears row.
- shared by /admin/login and /enroll.
- local SQLite check was noted previously, but Cloudflare D1 concurrency/atomicity is unverified.
- caller checks secret exists before comparison.

### ID generation (worker.js 99–115)
- nextId handles mother/chappy/fixed.
- lazily creates id_counters.
- M/C suffix starts at substring 2; fixed at substring 3; fixed prefix FR.
- initial counter from MAX current ID, then UPDATE +1 RETURNING.
- previous read-only observation found fixed IDs FR001–FR023.
- theoretical issue: if highest ID was deleted before counter initialization, MAX cannot know historical max. User recalls additions only/no deletes; no deletion observed. Do not describe deletion as fact.

### Admin CRUD (worker.js 165–249)
- hardcoded room allowlist mother_memories (M), chappy_profile (C), fixed_rules (FR).
- list all statuses, create, update, append, status 継続中/終了/取り消し, delete.
- missing update/status/delete target returns 404.
- fixed rules admin-curated, not auto-generated from chat.
- delete is permanent.

### Existing app endpoints (worker.js 251–408)
- /enroll: verifies CHAPPY_ADMIN_PASSWORD, creates random device token, stores only hash in device_tokens, returns raw token.
- requireDevice hashes bearer token and checks unrevoked device_tokens.
- /memories: M list/create/status/append.
- /chappy-profile: C list/create/status/append.
- /fixed-rules: active fixed_rules list.
- / or /chat: device-authenticated Groq.
- model openai/gpt-oss-120b, reasoning_effort low, include_reasoning false.
- stream=true passes Groq SSE body through; nonstream returns existing candidates JSON.
- admin token separate from device token.
- original baseline is user-provided 409-line worker.js, commit label 2fc30107, Library file turn9file1. GitHub main doesn't contain worker.js, so fetch 404 doesn't mean no baseline existed. User attachment was compared with test Worker.
- syntax check previously passed, but does not prove Cloudflare runtime/full compatibility.

## 6. Admin UI (preview/admin.html, 414 lines)
- tabs M mother, C Chappy, fixed rules.
- admin password login and show/hide.
- list/create/edit/append/status/delete.
- delete confirm; status 継続中/終了/取り消し.
- token in sessionStorage chappy_admin_session.
- logout attempts server revoke, distinguishes confirmed/unconfirmed, always clears local token.
- long records collapsed to 3 lines, arrow expands/collapses.
- count summary currently displays only selected room: total/継続中/終了/取り消し.
- **Potential gap:** user requirement is counts for each of M/C/fixed and each status. Current page shows one selected room only, not all 3 at once. Verify and adjust in test branch if required.
- HTML comment says API_URL empty but actual API_URL is test Worker. Comment stale.
- production adaptation must set both API_URL and Worker allowedAdminOrigin to exact verified production Pages origin. Do not guess.

## 7. Stale plan document
MEMORY_SYSTEM_PLAN.md has outdated/conflicting statements:
- says original Worker baseline unavailable; user-supplied baseline was available and compared.
- says session expiry 30 minutes; latest code/decision is 6 hours.
- says CORS origin azalea-soda.github.io; current Worker uses test Pages origin.
- says admin HTML API_URL empty; actual test Worker URL is set.
- says fixed IDs not verified/blocked; current code generates FR prefix.
- next-step list includes completed work and numbering gaps.
Update after checking current code and latest decisions.

D1_READONLY_CHECK.md contains SELECT-only SQL:
- schema from sqlite_master for fixed_rules/mother_memories/chappy_profile/id_counters.
- fixed-rule IDs/status.
- id_counters series/last_number if exists.
Confirm database name in Cloudflare before running. No write SQL.

## 8. Production/test separation
- main index.html/setup.html point to production Worker https://super-violet-bc7e.nanami-moca.workers.dev.
- voice worker URL https://chappy-voicevox-test.nanami-moca.workers.dev/speak.
- device token key chappy_device_token.
These are GitHub source settings; live deployed Worker version was not queried.
- test Worker chappy-memory-admin-test; Pages chappy-memory-admin-test.pages.dev; D1 chappy-memory-test ID fd96a54a-d13e-4c8f-bc62-7afffea55182.
- admin session migration is TEST D1 only.
- main/preview/index.html calls production Worker despite preview filename; never use it for test writes.
- no production D1 write/migration, no production record edit/delete, no production deploy, no merge during this investigation.

## 9. Automatic memory extraction
- main index loads D1 fixed_rules/M/C into system prompt.
- normal Groq /chat returns answer only; no extraction and INSERT of chat memories.
- test Worker has explicit M/C create API, but normal chat flow does not call it.
- automatic conversation-to-memory extraction/classification/save is not implemented.
- requirements: M stores mother's feelings/opinions/important memories/preferences/ongoing interests; C is Chappy profile; fixed_rules are admin-curated and never auto-generated. No numeric importance/frequency scores. Don't save guesses, duplicates, transient small talk, sensitive info or full transcripts. Preserve corrections/history and use corrected current fact. "Forget this" should be handled minimally and not resurfaced.
- plan: finish diff investigation and handoff record first, then design/build automatic memory in test environment.

## 10. Remaining tasks
1. Complete remaining exact comparison of main preview audio code/error handling; decide pause fix integration.
2. ARROWS WE2 device test: first-audio latency, ~4-second wall, gaps, natural chunking, interrupt, recovery.
3. Inspect current VOICEVOX Worker source/config/speaker ID (latest user choice: ずんだもん・ノーマル), URL expiry/CORS/latency.
4. Verify Cloudflare test Worker deployed version vs GitHub branch; combined status API was empty.
5. Read-only inspect test D1 schema and admin_sessions/admin_login_attempts/id_counters.
6. Decide whether admin counts must show all M/C/fixed totals and statuses simultaneously; current UI only shows selected room.
7. Review rate-limit SQL concurrency/atomicity on D1.
8. Consider permanent no-reuse ID strategy. User recalls no deletions; no evidence of deletion.
9. Verify exact production Pages origin before changing admin CORS/API_URL.
10. Update stale MEMORY_SYSTEM_PLAN.md based on code/current decisions.
11. Finish route-by-route compare of test Worker with supplied baseline: inputs/outputs/errors/SSE/device auth.
12. Verify Cloudflare live production Worker deployment/version vs GitHub main; currently unknown.
13. After diff investigation is complete and recorded, design M/C auto-extraction/save in test environment.
14. Only after testing all features, prepare production merge/deploy plan and get explicit approval.

## 11. Not changed
main index/setup/images unchanged; production Worker unchanged/not deployed; production D1 not written/migrated; production memories not edited/deleted; no merge to main; no voice branch merge; no test runtime code change during this inspection. This was source comparison, not device or live Cloudflare validation.

追記型で維持する。新しい調査では日付・参照SHA・確認内容を追記し、旧SHAと訂正履歴を残す。

---

# 12. Workers AI 記憶抽出テスト v1.0（2026-11-19）

## 目的と安全境界
チャッピーの会話から、母の記憶（M）・チャッピー自身の設定（C）・固定ルールを正しく抽出できるAI候補か、架空の日本語会話だけで独立評価する。これは抽出性能の検証であり、チャッピー本体の実装・接続・D1保存の作業ではない。

- 対象モデル：Cloudflare Workers AI `@cf/zai-org/glm-4.7-flash`
- 実行設定：thinking OFF
- 実施日：2026-11-19（日本時間）
- 実験データ：合成した架空会話のみ。実際のお母さんの会話・記憶は使用していない。
- 本番HTML、Worker、D1、Pagesへの変更なし。GitHubへの今回の追記も調査ログだけ。
- API推論は各回ユーザーの明示許可後に1回ずつ実行。無料枠や利用上限を超える自動再試行・有料化・自動課金は行わない。
- API成功と抽出品質の合否は別に判定する。

## Test 1：M/C/固定ルールの分類

### 使用した架空会話
- 母：「桜の季節が大好きなの。毎年楽しみだわ。」
- 母：「チャッピーは、自分のことをチャッピーって呼んでね。」
- 母：「分からないことがあったら、勝手に想像しないでね。分からないときは聞いてね。」

### 試行1（thinking ON、max_tokens 400）
- HTTP 200、API success=true。
- reasoningがcompletion 400 tokensを使い切り、message.content=null、finish_reason=length。JSON出力なし。
- usage：prompt 289 / completion 400 / total 689 tokens、16.1495 Neurons。
- 判定：抽出内容を評価できず、出力上限による不成立。モデルの分類能力の不合格とは扱わない。

### 試行2（thinking OFF、max_tokens 800）
- HTTP 200、API success=true。
- C「自分のことはチャッピーと呼ぶ」と固定ルール「分からないことは聞き、勝手に想像しない」は抽出。
- M「桜の季節が大好き」「毎年楽しみ」が完全に欠落。
- JSONをMarkdownのコードフェンスで囲んだ。
- usage：prompt 289 / completion 133 / total 422 tokens、6.4307 Neurons。
- 判定：Test 1不合格（Mの欠落、形式違反）。

### 試行3（抽出手順を明確化した改善プロンプト、thinking OFF、max_tokens 800）
改善点：発言を一つずつ確認し、M/C/固定ルールの全カテゴリを確認すること、最後に抽出漏れを点検すること、「毎年楽しみ」のような継続的な感情も保持することを明示。
- HTTP 200、API success=true、finish_reason=stop。
- JSON形式（コードフェンスなし）で4件を抽出：
  - M：桜の季節が大好き。
  - M：毎年桜の季節を楽しみにしている。
  - C：自分のことをチャッピーって呼んでほしい。
  - 固定ルール：不明なことは勝手に想像せず、聞く。
- 4件すべて内容・分類とも正しく、感情/継続的な楽しみも保持。
- usage：prompt 576 / completion 213 / total 789 tokens、10.9212 Neurons。
- 判定：改善プロンプトでTest 1合格。最初の失敗から、抽出漏れ対策の指示改善が有効だった。

## Test 2：感情の保持

### 使用した架空会話
母：「昨日、久しぶりに友達に会えたの。本当に嬉しかったわ。」

### 結果
- thinking OFF、max_tokens 800。
- HTTP 200、API success=true、finish_reason=stop。
- Mとして2件抽出：
  - 久しぶりに友達に会えた
  - 友達に会えて本当に嬉しかった
- 出来事と感情を分けて保持し、「本当に嬉しかった」という感情の意味も正確に保持。
- ただしJSONをMarkdownのコードフェンスで囲み、「JSONのみ」の形式指示に違反。
- usage：prompt 539 / completion 115 / total 654 tokens、7.1505 Neurons。
- 判定：内容面は合格、出力形式は要改善。全体評価は形式違反を残す。

## Test 3：訂正処理

### 入力した既存記憶と新しい架空会話
既存記憶：
- 母はバラが好き。

新しい会話：
- 母：「バラは苦手なの。桜のほうが好き。」

### 結果
- thinking OFF、max_tokens 800。
- HTTP 200、API success=true、finish_reason=stop。
- 「判定：訂正」と正しく判定。
- 既存の「母はバラが好き」を過去情報として残し、新規候補「母はバラが苦手で、桜が好き」を抽出。
- JSON形式は正しい（コードフェンスなし）。
- **重大な問題：入力に存在しない既存記憶ID「1」と、日付「2023-01-01T00:00:00Z」「2023-10-25T10:00:00Z」を生成した。** これらのID・日付はテスト入力に一切与えていない。
- usage：prompt 322 / completion 139 / total 461 tokens、6.8306 Neurons。
- 判定：訂正内容の理解は成功。しかしIDと日付の捏造によりTest 3全体は不合格。
- 次の試験では、既存記憶にIDや日付が与えられていない場合、AIがそれらを決して補完・捏造しないか確認する。ID・日時は記憶管理側が扱うべき情報であり、モデルに創作させない。

## ここまでの集計
| Test | 主な評価 | 判定 |
|---|---|---|
| 1 | 分類・抽出漏れ | 改善プロンプトで合格。初回改善前はM欠落 |
| 2 | 出来事と感情の保持 | 内容合格、JSONコードフェンス違反 |
| 3 | 訂正と履歴保持 | 訂正理解は成功、ID・日時捏造で不合格 |

共通して確認された課題：
1. 指示が曖昧/弱いとMの抽出漏れが起きる可能性。Test 1では全カテゴリの確認と最終漏れ点検を明示して改善した。
2. JSONのみと指示してもMarkdownコードフェンスを付ける場合がある（Test 1試行2、Test 2）。
3. 訂正内容は理解できても、入力にないID・日付を作る危険がある（Test 3）。この挙動は実データ管理で重大なため、後続試験でも厳しく確認する。

## 次の作業
- 次は承認済みテストセットのTest 4「重複と新情報の見分け」を実施する。
- その後Test 5「不明情報を推測しない」を実施する。
- 各テストはユーザーの明示許可後に1回ずつ推論し、実際の応答・usage・問題点をこのログに追記する。
- 事前に承認されたテストセットの主題・評価基準は不用意に変更しない。
- 無料枠、料金、停止条件の調査・明示承認なしに追加推論や有料利用へ進まない。


## Test 4：重複と新情報の見分け（2026-11-19）

### 入力した既存記憶と新しい架空会話
既存記憶：
- ID：M001
- category：M
- content：母は桜が好き。
- created_at / updated_at：null

新しい会話：
- 母：「桜の季節が大好きなの。毎年楽しみにしているわ。」

### 結果
- モデル：`@cf/zai-org/glm-4.7-flash`
- thinking OFF、max_tokens 800。
- HTTP 200、API success=true、finish_reason=stop。
- 出力は有効なJSON（Markdownコードフェンスなし）。
- 判定：「重複があり、新規として追加すべき情報はない。」
- recordsには既存記憶M001をそのまま返した。ID・category・contentを変更せず、日時もnullのまま保持。IDや日時の捏造なし。
- **問題：新しい会話に含まれる「毎年楽しみにしている」という既存記憶にない継続的な期待・気持ちを、新規情報として抽出できなかった。** 「母は桜が好き」と「毎年桜の季節を楽しみにしている」は関連するが同一情報ではない。
- usage：prompt 374 / completion 73 / total 447 tokens、4.7142 Neurons。
- 判定：Test 4不合格。重複保持とID保護はできたが、新情報の見落としがあった。



## Test 5：不明情報を推測しない（2026-11-19）

### 使用した架空会話
母：「あの大会、今年も楽しみね。」
母：「前に話したあの子も出るのかな？」

### 結果
- モデル：`@cf/zai-org/glm-4.7-flash`
- thinking OFF、max_tokens 800。
- HTTP 200、API success=true、finish_reason=stop。
- 出力は有効なJSON（Markdownコードフェンスなし）。
- 判定：「不明」。
- recordsは空配列。大会名・競技名・人物名などを推測して記憶登録しなかった。
- 確認事項として「『あの大会』とはどの大会か」「『あの子』とは誰か」の2点を提示。
- 一時的な話題を確定した長期記憶として保存しないという指示にも沿った結果。
- usage：prompt 398 / completion 48 / total 446 tokens、3.9362 Neurons。
- 判定：Test 5合格。曖昧な指示対象を特定せず、確認質問に回せた。



## Test 3 改善再試行：訂正ルール変更後（2026-11-19）

### 新たに合意した管理ルール
ユーザーと相談し、訂正・追加・重複の扱いを次のように整理した。
1. **間違いの訂正：** 既存IDの内容を正しい情報に上書きする。古い誤情報を履歴として残さない。管理者が誤情報を別途「取り消し」にする作業を増やさない。
2. **追加情報：** 関連する既存記憶があれば、できるだけ同じIDの内容に追記する。関連する既存記憶がなければ新しいIDを作る。
3. **単なる表現の補足：** 意味が同じなら重複登録しない。
4. 訂正対象や意味の判断が曖昧な場合は、自動で変更しない。
このルールは調査・設計方針であり、Worker/D1/アプリへの実装変更は行っていない。

### 入力
既存記憶：
- ID：M001
- category：M
- content：母はバラが好き。
- created_at / updated_at：null

新しい会話：
- 母：「バラは苦手なの。桜のほうが好き。」

### 実行条件・結果
- モデル：`@cf/zai-org/glm-4.7-flash`
- thinking OFF、max_tokens 800。
- ユーザーの明示許可後に1回実行。
- HTTP 200、API success=true、finish_reason=stop。
- 出力：
  - 判定：「訂正」
  - records：M001 / category M / content「母は桜が好き。」 / created_at null / updated_at null
- usage：prompt 453 / completion 68 / total 521 tokens、4.9667 Neurons。

### 評価
- 訂正判定：成功。
- 既存ID M001の維持：成功。
- 架空ID・架空日時の生成なし：成功。
- 古い誤情報「母はバラが好き」を出力に残さなかった：成功。
- **訂正内容の完全性：不合格。** 会話に明示された「バラは苦手」という重要情報が新しい内容から欠落した。正しい更新内容は少なくとも「母はバラが苦手で、桜が好き。」を保持する必要がある。
- **出力形式：要改善。** JSONをMarkdownコードフェンスで囲み、「JSONのみ」の指示に違反。
- 総合判定：部分成功だが、訂正内容の欠落と形式違反があるためTest 3はまだ合格にしない。

### 次の改善観点
訂正では、古い誤情報を残さず、会話で明示された訂正内容をすべて保持する。今回なら「バラが苦手」と「桜が好き」の両方を一つの更新内容に含める。既存ID・日時はモデルに創作させない。JSONコードフェンスの抑止も継続課題。


## Test 3 改善再試行2：訂正情報の全件保持（2026-11-19）

### 実行条件
- モデル：`@cf/zai-org/glm-4.7-flash`
- thinking OFF、max_tokens 800。
- 既存記憶：M001 / M / 「母はバラが好き。」 / created_at・updated_at はnull。
- 新しい架空会話：母「バラは苦手なの。桜のほうが好き。」
- 訂正時に会話中の事実を省略しないこと、「バラが苦手」と「桜が好き」の両方を必ず保持すること、既存IDとnull日時を維持することを明示。
- ユーザーの明示許可後に1回実行。

### 結果
- HTTP 200、API success=true、finish_reason=stop。
- 出力はJSONのみ（コードフェンスなし）。
- 判定：「訂正」。
- records：M001 / category M / content「母はバラが苦手で、桜が好き。」 / created_at null / updated_at null。
- usage：prompt 486 / completion 71 / total 557 tokens、5.2574 Neurons。

### 評価
- 訂正判定：成功。
- 既存ID M001の維持：成功。
- 「バラが苦手」と「桜が好き」の両方の保持：成功。
- 古い誤情報「母はバラが好き」の除去：成功。
- 架空ID・日時の生成なし：成功。
- JSONコードフェンスなし：成功。
- **判定：今回の改善版Test 3は合格。** 前回の再試行で欠落した「バラが苦手」を含め、訂正後に必要な情報をすべて保持できた。今回の入力範囲では、合意した訂正ルールに沿った結果となった。

### 注意
これは合成データによる単一ケースの成功であり、訂正処理全般の安全性を証明するものではない。実装・本番接続・D1更新は行っていない。


## Test 4 改善再試行：関連する既存記憶への追加情報（2026-11-19）

### 実行条件
- モデル：`@cf/zai-org/glm-4.7-flash`
- thinking OFF、max_tokens 800。
- 既存記憶：M001 / category M / content「母は桜が好き。」 / created_at・updated_at はnull。
- 新しい架空会話：母「桜の季節が大好きなの。毎年楽しみにしているわ。」
- 既存情報と新情報を個別に比較し、「毎年楽しみにしている」は「桜が好き」と同じ意味ではないこと、両方を更新後contentに含めること、関連情報は同じIDに追記すること、IDとnull日時を維持することを明示。
- ユーザーの明示許可後に1回実行。

### 結果
- HTTP 200、API success=true、finish_reason=stop。
- 出力は有効なJSON（Markdownコードフェンスなし）。
- 判定：「訂正」。
- records：M001 / category M / content「母は桜が好き。毎年楽しみにしている。」 / created_at null / updated_at null。
- usage：prompt 559 / completion 72 / total 631 tokens、5.6953 Neurons。

### 評価
- 既存ID M001の維持：成功。
- 既存情報「母は桜が好き」の保持：成功。
- 新情報「毎年楽しみにしている」の追加：成功。前回の失敗（新情報を重複と誤認して捨てた）を改善した。
- 架空ID・日時の生成なし：成功。
- JSONコードフェンスなし：成功。
- **判定ラベル：不合格。** 今回は誤情報の訂正ではなく、既存記憶への関連情報の追加なので「追加」が適切だが、モデルは「訂正」と出力した。
- **内容の明確さ：一部改善余地あり。** 「毎年楽しみにしている」は直前の桜の話題を受ける文脈では理解できるが、「毎年桜の季節を楽しみにしている」と対象を明示したほうが、後で単独の記憶として読んでも誤解が少ない。

### 総合判定
**部分合格。** 新情報の見落としは改善し、既存IDに追記できた。一方、追加と訂正の判定を取り違えたため、Test 4全体はまだ合格にしない。今後は「間違いの置き換え」と「正しい既存情報への追加」を明確に区別する必要がある。

### 注意
これは合成データによる単一ケースの結果であり、重複・追加判定全般の安全性を証明するものではない。Worker/D1/アプリへの実装変更は行っていない。
