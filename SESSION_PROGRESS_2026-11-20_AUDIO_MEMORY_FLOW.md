# 2026-11-20 音声会話経路・記憶自動保存の接続確認

## 対象
- Repository: `Azalea-soda/chappy-room-main`
- Branch: `memory-admin-v1`
- 確認日: 2026-11-20
- 確認方法: GitHub上のソースコード静的確認。Cloudflare上のライブWorker/Pagesの稼働確認ではない。

## 音声入力から会話応答までの現行経路
- `index.html` はブラウザの SpeechRecognition / webkitSpeechRecognition を使用する。
- 音声認識言語は `ja-JP`、`continuous=true`、`interimResults=false`。
- 確定した認識文は `sessionUserTexts` に追加される。
- マイク終了時に認識文を連結し、`finishRecognition()` から `getChappyResponse(fullTalk)` に渡す。
- `getChappyResponse(userText)` はD1の知識を読み込んで会話用プロンプトを作り、`requestChappyAI()` からWorkerの `/chat` にSSE送信する。
- Workerの `/chat` はGroqの `openai/gpt-oss-120b` へ中継する。
- したがって、音声認識で得た文章は通常のチャッピー会話応答経路に接続されている。

## 記憶抽出・自動保存の現状
- 確認した `index.html` と `worker.js` の範囲では、会話後にGLM記憶抽出を呼び出す処理、抽出JSONの検証、D1への自動保存処理は見当たらない。
- 現状はD1の記憶読み込みと会話プロンプトへの利用はあるが、会話からの記憶自動抽出・保存は未接続と判断する。
- 今回の実マイクを使った音声会話テストは未実施。過去に音声認識/TTSが動作したという報告とは区別する。
- この判断はGitHubソースの静的確認に基づくもので、Cloudflareライブ環境での実行確認ではない。

## 次に行う順序
1. テスト版の実URL、デプロイ先、接続Worker/D1を確認し、本番環境と混同しない。
2. テスト版で、マイク音声入力 → 音声認識 → Groq会話応答 → VOICEVOX読み上げの一連の動作を確認する。
3. その後、実音声から認識された会話テキストを使う記憶抽出・保存フローをテスト環境で設計・実装・検証する。
4. 検証では、会話応答を遅らせないこと、Workers AI Neurons/無料枠の消費、失敗時に安全停止することを確認する。
5. テスト合格前に本番Worker/D1/Pagesや `main` を変更しない。コード変更・デプロイ前に対象と影響を説明し、ユーザー確認を得る。

## 安全・作業上の注意
- 本番環境への変更、デプロイ、マージは今回行っていない。
- 今後の検証・実装はまずテスト環境で行う。
- 会話の楽しさと応答速度を最優先し、記憶機能は会話を支える裏方として扱う。
