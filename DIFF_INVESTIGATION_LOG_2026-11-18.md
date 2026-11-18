# Chappy production/test difference investigation log
Updated: 2026-11-18 (JST)
Repository: Azalea-soda/chappy-room-main

## 0. Purpose and safety boundary

This is a working investigation log, not an approval to merge or deploy.
Its purpose is to let the next development session continue from the exact investigation already performed instead of repeating it.

Rules:
- Do not change production Worker, production D1, production Pages, or merge into main without the user's explicit approval.
- Do not run production writes, migrations, or test records against production D1.
- Keep confirmed facts, historical facts, and unverified assumptions separate.
- A GitHub source review does not prove what is currently deployed on Cloudflare.
- The user wants the whole investigation trail preserved: branches, SHAs, file paths, comparisons, code locations, conclusions, issues, unknowns, and next steps.
- The original app UI, device enrollment, speech recognition, voice playback, and existing D1 data must be preserved.

## 1. Repository and branch snapshot

Repository: Azalea-soda/chappy-room-main

Branch heads observed during this investigation:
- main: 487c78eecbe80396c14a8aae579a265a91fb7dc6
- memory-admin-v1: cd0d5616f472afd7b7ef731dacdeef73b5f182cd
- voice-stream-queue-v1: ea6348427def6805f81bad6d0767443d074ca311
- voice-stream-queue-v2: 98c2ace5e2343bc96f969f73c82602967621ef73
- chappy-speed-diagnostics: a54bee856bce42887c5e3d0b7eef53a13136e0b5

Important file blob SHAs:
- main/index.html: e8badb522748e7ece2ba5e13ea7c5160911abcb6
- voice-stream-queue-v1/index.html: 4875a96650acbb7f836fafae67c11f0756e24571
- voice-stream-queue-v2/index.html: 4875a96650acbb7f836fafae67c11f0756e24571
- main/preview/index.html: b606676a9b6e9e8adfd3cf5e6699894e7d1df3fc
- memory-admin-v1/worker.js: 1668d0f20883bc377cf7ba777ff52d59eb0557cb
- memory-admin-v1/preview/admin.html: 94d5ed08088fbfe27fc9b378f179d4d499c6a3e2
- memory-admin-v1/migrations/0001_admin_sessions.sql: 064461bdf22e94e4b46101aba18f73898e791d10
- memory-admin-v1/wrangler.toml: 42998f912c34237111e01bd965d89592b56a226c
- main and voice-stream branches' memory.json: c9c1d85d56c0a96583ea0825bd998f6fc354ff74

The archived repository Azalea-soda/chappy-room-archive is read-only and must not be used as the development target.

## 2. Branch comparison results

### 2.1 main vs voice-stream-queue-v1
GitHub compare result:
- status: diverged
- ahead_by: 16
- behind_by: 5
- merge base: dd505e21171dd1b2293083202fefdcb97f8c8809
- files in compare: .github/workflows/validate-test-branch.yml added (+38); index.html modified (+287/-30); memory.json modified (+27/-27).

### 2.2 main vs voice-stream-queue-v2
GitHub compare result:
- status: diverged
- ahead_by: 5
- behind_by: 3
- merge base: 148835cf5d96b137a557983ef5de8eb52ebebe30
- files in compare: .github/workflows/validate-test-branch.yml added (+38); index.html modified (+287/-30).

### 2.3 voice-stream-queue-v1 vs voice-stream-queue-v2
GitHub compare result:
- status: diverged
- ahead_by: 7
- behind_by: 16
- merge base: dd505e21171dd1b2293083202fefdcb97f8c8809
- files in compare: workflow added (+38); index.html modified (+287/-30); memory.json modified (+27/-27).

Despite different branch histories and workflow files, the final index.html blob is identical on v1 and v2. The final memory.json blob is also identical to main. The workflow files differ only in the push branch name:
- v1 workflow watches voice-stream-queue-v1.
- v2 workflow watches voice-stream-queue-v2.
Both extract inline JavaScript from index.html and run Node 22 node --check.

### 2.4 main vs chappy-speed-diagnostics
The diagnostics branch is an ancestor of main. The compare reports main ahead by 9 commits and no remaining file diff in that direction. The diagnostics work was merged into main through PR #1, merge commit 26814c3807e498f7fae4ceca43cceee51a7e924e on 2026-11-14. Do not treat this branch as a separate unmerged feature that needs to be merged again.

### 2.5 main vs memory-admin-v1
GitHub compare result:
- status: diverged
- ahead_by: 32
- behind_by: 1
- merge base: db98020d865ce2505076a083e96e485b3f1b9d0a
- only eight added files are reported; no existing app file is modified.

The eight added files are:
1. .github/workflows/worker-syntax.yml
2. D1_READONLY_CHECK.md
3. MEMORY_SYSTEM_PLAN.md
4. TEST_WORKER_DEPLOY_TRIGGER.md
5. migrations/0001_admin_sessions.sql
6. preview/admin.html
7. worker.js
8. wrangler.toml

The existing app files have the same blob SHA on main and memory-admin-v1: index.html, setup.html, preview/index.html, memory.json, profile.json, and all app images. This means the memory-admin branch adds the admin subsystem separately; it does not replace the app UI or root app code.

The one main-side commit absent from memory-admin-v1 is the README guidance commit. It does not change app runtime behavior.

## 3. Voice optimization investigation

### 3.1 Current main app behavior
main/index.html is 1009 lines, blob SHA e8badb522748e7ece2ba5e13ea7c5160911abcb6.

Relevant locations:
- API URLs and state: around lines 244-264.
- AI SSE parser: around lines 530-624.
- getChappyResponse: around lines 626-727.
- speakChappyVoice: around lines 734 onward.
- audio buffering and next-part preloading: around lines 795-958.

Main currently:
- Requests Groq using the SSE streaming path.
- Appends received deltas to the visible chat bubble.
- Buffers speech text and extracts only complete sentences ending in [。！？!?] using a regular expression around line 666.
- Enqueues each completed sentence into speechChain, which serially awaits speakChappyVoice.
- If no sentence-ending punctuation arrives before the AI stream finishes, the remaining buffer is only queued after the full AI text is received.
- speakChappyVoice divides long speech into smaller parts (around 767-790) and has a next-part audio prefetch flow (around 792 onward). Therefore main already preloads the next audio part while the current part is playing, but it does not have the newer early phrase splitting + separate concurrent synthesis/playback workers.

Accurate distinction: main is not wholly non-streaming. AI text streams and audio is split/prefetched inside speakChappyVoice. The missing part is the new phrase-level splitter and dual-worker voice pipeline that can start synthesis before a full sentence is completed.

### 3.2 voice-stream-queue-v2 speech segmentation
voice-stream-queue-v2/index.html is 1266 lines, SHA 4875a96650acbb7f836fafae67c11f0756e24571.

Relevant locations:
- interrupt/cancel path: around lines 441-474.
- splitSpeechBuffer: lines 637-676.
- queueSpeechChunk: lines 678-681.
- speakChappyStream: lines 683-879.
- getChappyResponse: lines 881-984.

splitSpeechBuffer behavior:
- Searches punctuation [、。！？!?].
- A 。, ！, ？, !, or ? ends a chunk regardless of length.
- A 、 is accepted only when the candidate chunk is at least 12 characters.
- If punctuation has not arrived and the remaining buffer is at least 28 characters, it searches possible cut points from 18 to 34 characters for natural Japanese endings including けれども, けれど, けど, ので, のに, だから, ですが, たら, なら, ても, てから, ながら, ですね, ですよ, ます, です, だよ, だね, かな.
- If an ending is found, it queues the phrase without waiting for a punctuation mark.
- At final flush, any remaining text is queued as the last chunk.

Therefore the previous description “it waits only for punctuation” is incorrect. Natural sentence/phrase endings are also explicitly supported. It still recognizes punctuation as one of the triggers; do not say it never uses punctuation.

### 3.3 voice-stream-queue-v2 audio pipeline
speakChappyStream uses:
- textQueue: speech chunks awaiting synthesis.
- audioQueue: generated audio waiting for playback.
- synthesisWorker: sends one VOICEVOX request at a time.
- playbackWorker: plays queued audio.
- audioQueue is limited to one waiting audio item, allowing one audio to play while the next is generated/preloaded.
- generation IDs prevent stale work from continuing after cancellation.
- AbortController cancels an in-flight VOICEVOX fetch.
- speechPipelineControls exposes enqueue, finishText, cancel for the active generation.
- audio failure/cancel paths wake both workers and clean up queues/audio references.
- Promise.allSettled waits for both workers and then removes pipeline controls.
- getChappyResponse starts the speech pipeline before requesting the AI response, queues chunks as Groq deltas arrive, and waits for the audio pipeline after the AI text is complete.
- Voice pipeline failure aborts the AI stream.
- Pressing the mic while processing/speaking increments responseGeneration, cancels the voice pipeline, aborts AI and voice requests, stops current and prefetched audio, and returns the button to idle.

This is designed to overlap AI text generation, VOICEVOX synthesis, and playback rather than serially waiting for each sentence. It does not prove any particular latency; actual Android device and network measurements are still required.

### 3.4 Existing helper and possible cleanup point
The legacy speakChappyVoice function remains in voice-stream-queue-v2 for fallback/error messages and retains its own audio splitting/prefetch logic. It is not the main response pipeline once speakChappyStream is used.
firstTextAt is assigned in getChappyResponse around line 898 but is not subsequently used by the new pipeline in this version. Treat as a possible leftover variable, not as a proven defect.

### 3.5 Voice pipeline evolution in commit history
voice-stream-queue-v1 commit history includes:
- 570901a0eca2: Add queued streaming voice pipeline prototype
- 1bf07c22d53d: Handle cancellation in queued voice pipeline
- 5d2199ad571f: Improve punctuation-aware phrase splitting
- 07b752f0412c / 30e3f18c881d / 00d7e459021b: failure and cleanup hardening
- dc7e6c2386a5: Ignore chunks after cancellation
- 1c1a7ad6fb28: Stop queued playback when synthesis fails
- 7ffa389fc7ef: Handle playback failures
- 6fa450e72818 / bd49ed54faae / 73209fd9157c: abort AI stream on voice failure and retain pipeline result for error handling
- 9b3f786ba8c6: isolated JavaScript syntax validation workflow
- b36fbe6bb3dc / ab4ca17b6a43: remove and restore migrated memory.json backup
- final branch commit ea6348427def: Restore memory.json recovery backup.

voice-stream-queue-v2 commit history includes:
- 250d08c2a050: Add voice streaming queue to clean test branch
- 26132a9891cb / af19c793c65e: add/run JS syntax validation
- d2eed306eadb / 98c2ace5e234: fix workflow inline-JavaScript extraction regex
- 148835cf5d96 / f133946835ba: restore/remove legacy memory.json backup
- final branch commit 98c2ace5e234.

The v1 and v2 final index.html files have the exact same SHA despite different commit graph histories.

### 3.6 Isolated preview page in main
main/preview/index.html:
- SHA b606676a9b6e9e8adfd3cf5e6699894e7d1df3fc
- 1275 lines.
- It contains splitSpeechBuffer and speakChappyStream and therefore has the new streaming queue in a separate preview page.
- Compared directly with voice-stream-queue-v2/index.html, the differences found were:
  1. Six GitHub Pages asset path changes, adding /chappy-room-main/ to background image, cat image, hanamaru, mic-bk and mic-icon paths.
  2. A pause-event fix described below.
- It does not replace main/index.html. It is a separate page at preview/index.html.

Commits:
- cfacd5bb2476: Add isolated voice streaming preview page.
- db98020d865c: Fix natural audio end pause handling in preview.
- 487c78eecbe8: Add current repository guidance README.

The pause fix in db98020d865c changes audio.onpause:
- If cancelled or generation changed, finish and return.
- If audio.ended is true, or currentTime is within 0.25 seconds of duration, treat pause as normal completion.
- Otherwise treat it as unexpected pause and fail playback.
This fix exists in main/preview/index.html but not in the voice-stream-queue-v2 root index.html blob. It must be preserved if integrating the queue.

### 3.7 Voice preview and production URLs
The preview page and app source refer to:
- App Worker: https://super-violet-bc7e.nanami-moca.workers.dev
- Voice Worker: https://chappy-voicevox-test.nanami-moca.workers.dev/speak
- Device token localStorage key: chappy_device_token

The source configuration is confirmed in the repository. The currently deployed live code/version for either Worker has not been queried in this investigation.

## 4. Memory admin test branch investigation

### 4.1 Branch structure
memory-admin-v1 adds admin functionality without changing existing app runtime files.
Latest branch head observed: cd0d5616f472afd7b7ef731dacdeef73b5f182cd.

Recent commit history includes:
- b7c433c14266: Add admin memory management page draft
- ef26442ab0c9: Document memory/admin requirements
- cb643cea7b70: Fail closed admin page until isolated test Worker configured
- 51cc5cf13d09: Add isolated admin session migration
- 93a427833985: Add isolated development Worker with admin session and record routes
- cf4fbacd9c6d: Move shared ID generator before admin record routes
- 80a2efedc06a: Add record append and revoke admin session on logout
- 5c0b3c3b867b: Add automated Worker syntax validation
- e1e9be257606: Record Worker draft and verification requirements
- 76ea1fab1528: Restrict admin CORS preflight
- 3e83934a9920: Block fixed-rule creation pending ID verification
- 7c87d85533d6: Add read-only D1 schema inspection instructions
- 663867ac2412: Correct implementation notes and safety steps
- cc3e5a3893a3: Support verified FR fixed-rule IDs
- 2c83f18d896c: Expose all memory status values
- 9b611c832445: Record verified live D1 schema and ID formats
- 15c7214db326: Harden admin password checks and login throttling
- 6385ffee5afb: Fix not-found handling and logout revocation checks
- 5c8422859286: Show accurate admin logout result
- 6159451e3dd7: Restrict admin CORS to test Pages origin
- 44a038677e75: Connect admin preview to isolated test Worker
- 253e54ebb57d: Add Wrangler config for test admin Worker
- 7aefa920b7c1: Trigger first test Worker build
- ca2e712ac254: Set admin sessions to fixed six-hour expiry
- 1a29a8ea7726: Simplify password visibility labels
- 0ee44656cf3c: Show long memory records collapsed to three lines
- 70a866523a67: Improve record expansion with inline arrow toggle
- latest cd0d5616f472: Use up arrow to collapse expanded memory records

### 4.2 Test environment
- Test D1 name: chappy-memory-test
- Test D1 ID: fd96a54a-d13e-4c8f-bc62-7afffea55182
- Test Worker name: chappy-memory-admin-test
- Test Worker URL: https://chappy-memory-admin-test.nanami-moca.workers.dev
- Admin Pages origin: https://chappy-memory-admin-test.pages.dev
- Wrangler config binds DB to the test D1 ID above.
- Do not replace the test D1 binding with production D1 when adapting code.
- Admin CORS allowlist currently points to the test Pages origin.

### 4.3 Worker implementation
worker.js is 422 lines, SHA 1668d0f20883bc377cf7ba777ff52d59eb0557cb.

Security and shared helpers:
- POST/OPTIONS only.
- Normal app API CORS remains wildcard; /admin/* routes require exact test Pages Origin.
- D1 binding env.DB required.
- Device tokens are checked by SHA-256 hash against device_tokens and must not be revoked.
- Admin routes use a separate bearer session token, not the mother's device token.
- Admin token is random 32-byte token; only SHA-256 hash is stored in admin_sessions.
- Session expiry is 6 hours in current code (line 132) and this is the latest user-approved decision. Older plan text saying 30 minutes is stale.
- Logout revokes the token hash and checks that at least one row was changed.
- Admin errors are returned generically; normal app errors retain error details.
- Existing CHAPPY_ADMIN_PASSWORD is reused for both /enroll and /admin/login. Do not silently introduce another password; discuss if this should ever change.

Rate limiter:
- admin_login_attempts is created lazily by Worker SQL.
- Failed attempts are keyed by SHA-256 hash of CF-Connecting-IP with a prefix.
- Five failures within the 15-minute window lead to a 15-minute block.
- This limiter is shared by /admin/login and /enroll.
- The logic has been reviewed in source; Cloudflare D1 runtime and concurrency behavior still require testing.

ID generation:
- id_counters is created lazily.
- M series maps to mother_memories, prefix M, numeric suffix begins after 1-character prefix.
- C series maps to chappy_profile, prefix C.
- fixed series maps to fixed_rules, prefix FR, numeric suffix parsing starts after two-character prefix.
- IDs are padded to three digits (M001, C001, FR001).
- Initial counter is based on MAX current ID when the series counter row is first created.
- If highest IDs had been deleted before counter initialization, MAX could not know historical maxima. The user believes records have only been added and none deleted; no deletion evidence has been observed. Treat this as theoretical risk only, not as a discovered deletion.

Admin record API:
- POST /admin/login
- POST /admin/logout
- POST /admin/records with hard-coded allowlist of mother_memories, chappy_profile, fixed_rules.
- list returns all statuses.
- create adds a継続中 record with next ID.
- update changes category/content and updated_at.
- append adds newline + new content.
- status accepts 継続中, 終了, 取り消し.
- delete permanently deletes a row.
- unknown room/action rejected.
- update/status/delete return 404 if the record does not exist.
- Fixed-rule IDs use FR prefix.
- /enroll retains existing device enrollment behavior but now uses the shared password rate limiter.
- /memories and /chappy-profile retain device-authenticated list/create/status/append behavior.
- /fixed-rules remains a device-authenticated active-only list.
- /chat and / continue to call Groq openai/gpt-oss-120b with reasoning_effort low and include_reasoning false; JSON and SSE response paths are supported.

Migration:
migrations/0001_admin_sessions.sql creates admin_sessions and indexes on token_hash and expires_at.
The migration explicitly says test D1 only; never apply to production without separate explicit approval.
admin_login_attempts and id_counters are lazy-created by Worker, whereas admin_sessions requires the migration/table to exist.

### 4.4 Original Worker baseline
The user supplied the authoritative original 409-line worker.js source (attachment recovered from Library as turn9file1, described as commit 2fc30107). GitHub fetch_file for that old commit returned 404 because the source is not committed at that ref; this does not mean the user-supplied baseline was missing.
The supplied baseline was reviewed against the test Worker. Preserved behavior includes:
- POST/OPTIONS gate and JSON response structure.
- env.DB requirement.
- SHA-256 device token verification.
- /enroll route and random token issuance with only token hash stored.
- /memories and /chappy-profile list/create/status/append routes and response keys.
- /fixed-rules active-only list.
- / or /chat Groq endpoint, model and response compatibility, JSON and SSE passthrough.
- Existing M/C ID generation behavior extended to fixed_rules.
New test functionality includes admin login/logout, admin session, CORS restriction, rate limiting, admin CRUD, and FR ID generation.
Do not use the outdated unrelated Nov 11 Worker attachment as the baseline.

### 4.5 Admin UI
preview/admin.html:
- 414 lines, SHA 94d5ed08088fbfe27fc9b378f179d4d499c6a3e2.
- M, C, fixed-rule tabs.
- Add, edit/correct, append, status change, delete.
- Delete requires explicit confirmation and is permanent.
- Status changes require confirmation.
- Long records collapse to three lines and expand/collapse with arrow control.
- Password show/hide.
- Admin token stored in sessionStorage key chappy_admin_session.
- Logout tries server-side revoke, clears browser session regardless, and tells the user whether server revocation was confirmed.
- Session notice reflects six-hour maximum.
- UI currently shows total/active/ended/cancelled counts only for the currently selected room. It does not display all three room totals simultaneously. Confirm whether this fully meets the user's requirement for per-room count visibility.
- API_URL currently points to test Worker. A nearby code comment still says the URL is empty until the test Worker is ready; that comment is stale.
- Do not connect this page to the production Worker without explicit approval and a verified production Pages origin.

### 4.6 Supporting documents and stale content
D1_READONLY_CHECK.md contains SELECT-only SQL for:
- sqlite_master table definitions for fixed_rules, mother_memories, chappy_profile, id_counters.
- fixed-rule IDs/status.
- id_counters.
It explicitly warns not to run writes or migrations against production.

worker-syntax.yml runs Node 22 node --check worker.js on memory-admin-v1 pushes affecting worker.js/workflow. Syntax check is not runtime, D1, or full security verification.

MEMORY_SYSTEM_PLAN.md has stale/inconsistent statements that must be corrected before treating it as authoritative:
- Says no user baseline was available; the user-supplied 409-line baseline was later recovered and compared.
- Says admin token expiry 30 minutes; current code/user decision is 6 hours.
- Says admin CORS origin is https://azalea-soda.github.io; current test Worker allowlist is https://chappy-memory-admin-test.pages.dev.
- Says preview/admin.html API_URL is empty; it currently points to the test Worker.
- Says fixed-rule ID generation is blocked/not yet supported; current Worker supports FR IDs.
- Next steps include work already completed.
Do not rely on this plan doc without reconciling it against current code and latest decisions.

TEST_WORKER_DEPLOY_TRIGGER.md documents a test-only deployment trigger and says main/production D1 are not targets.

## 5. Automatic memory creation status

Automatic memory extraction and saving from ordinary conversation is NOT implemented yet.
Already present:
- App loads M memories, C profile, and active fixed rules from D1.
- The AI prompt uses these records.
- Admin/test API can manually create/edit/append/status/delete records.
Not present:
- Automatic candidate detection from chat.
- M vs C classification.
- Duplicate/conflict detection against existing records.
- Automatic write from the chat flow into D1.
Fixed rules must remain administrator-curated and must never be auto-generated from conversation.
The planned automatic memory system should be conservative: only clear useful M/C facts, no guesses/transient small talk/sensitive data/full transcripts, preserve corrections/history, avoid duplicates, and do not auto-save uncertain cases. Do not use numeric importance or frequency scores.

## 6. Production status and what has NOT happened

Configured production app Worker endpoint in main/index.html:
https://super-violet-bc7e.nanami-moca.workers.dev

Configured Voice Worker endpoint:
https://chappy-voicevox-test.nanami-moca.workers.dev/speak

The live deployed Cloudflare Worker source/version was not queried during this investigation. Repository source/configuration is confirmed; live deployment parity remains unverified.

No production merge, production deployment, production D1 migration, or production D1 write has been performed. Existing production D1 records must be preserved. Test D1 and production D1 must remain isolated.

## 7. Confirmed facts vs open questions

Confirmed from repository source:
- main root index still uses serial speechChain for sentence queueing.
- main preview/index contains the newer queue pipeline plus pause-end fix.
- voice-stream v1/v2 index files have identical SHA.
- memory-admin-v1 adds eight files and does not modify existing app files.
- test Worker has six-hour admin session expiry, rate limiter, admin CRUD, and FR ID generation.
- current admin UI counts only the selected room.
- auto memory extraction is not present in ordinary chat flow.

Not yet verified:
- Exact live deployed Worker code/version on Cloudflare.
- Runtime behavior of test Worker on Cloudflare D1 for all routes and race/error cases.
- Whether the latest GitHub Actions workflow runs completed successfully (combined status query returned no status entries).
- Actual Android ARROWS WE2 latency and audio continuity with the new queue.
- Whether count display should be revised to show M/C/fixed totals simultaneously.
- Whether the stale MEMORY_SYSTEM_PLAN.md should be updated in a separate documentation commit.
- Whether production schema/counters still match earlier read-only observations; do not assume without a fresh read-only check.

## 8. Next investigation steps

1. Continue from this log; do not repeat branch discovery and source comparison above.
2. Complete any remaining review of admin Worker and admin UI against the original baseline and the user's current requirements.
3. Confirm test Worker/D1 behavior only in the isolated test environment; no production writes.
4. Decide whether the count summary should show each of M, C, and fixed_rules simultaneously, in addition to per-status counts.
5. Review the voice preview on an actual target Android device and capture timings/logs before selecting the exact pipeline version for integration.
6. Design and implement M/C-only automatic memory extraction and D1 save in the test environment after the current difference review is properly documented.
7. Only after all test features are verified, plan a controlled production integration. Ask for explicit approval before any production merge, deployment, D1 migration, or write.

End of current investigation checkpoint. Append future findings to this file with date, exact refs/SHAs, inspected line ranges, and clear confirmed/unverified labels.
