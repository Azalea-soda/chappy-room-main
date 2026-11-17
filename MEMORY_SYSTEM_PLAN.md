# Chappy memory system v1 — implementation notes

This work is isolated on branch `memory-admin-v1`. Nothing here is deployed to the production Worker or merged into `main`.

## Canonical data stores
- `mother_memories` (M): mother's feelings, opinions, meaningful memories, preferences and ongoing interests.
- `chappy_profile` (C): Chappy's own likes, experiences and developing profile.
- `fixed_rules`: identity, tone, promises and absolute behavior rules. These are curated by the administrator only and are never auto-generated from ordinary conversation.

Keep the existing record fields `id, category, content, created_at, updated_at` and existing `status`. Do not add importance or frequency scores.

## Required memory behavior
1. Conversation memory collection may save only clear, useful M or C facts. It must never write fixed rules.
2. Do not save guesses, transient small talk, sensitive details, passwords, or full conversation transcripts.
3. Preserve corrections: update the relevant existing memory and retain correction/history where appropriate rather than silently losing important context.
4. Avoid duplicates. If classification or usefulness is uncertain, do not save automatically.
5. After handover, the owner must be able to remotely view, add, edit/correct, append, deactivate/reactivate, and delete records in all three stores.
6. Reuse the existing `CHAPPY_ADMIN_PASSWORD` secret. Do not introduce another password and never put the password in frontend code or GitHub.
7. Mother's device token and administrator session are separate credentials. Admin sessions are short-lived; the browser stores the token only in `sessionStorage`.
8. Never run write tests against production D1.

## Current implementation state (2026-11-17)
- The development Worker is based on the user's supplied 409-line Worker source. Existing device-authenticated app routes, enrollment behavior, Groq GPT-OSS 120B connection, and SSE streaming path have been retained in the draft.
- The draft adds admin login/logout and allowlisted record operations. It checks the existing `CHAPPY_ADMIN_PASSWORD`, stores only a SHA-256 hash of a random admin token in `admin_sessions`, and gives the token a 30-minute expiry.
- Admin CORS is restricted to `https://azalea-soda.github.io`; ordinary app API CORS remains separate.
- Read-only inspection of the live production D1 previously confirmed all three memory tables have the six fields `id, category, content, created_at, updated_at, status`. M and C IDs use `M001...` and `C001...`; fixed-rule IDs use `FR001...` (observed through `FR023`). This information is used only for compatibility planning; no production writes have been made.
- `preview/admin.html` has login/logout, M/C/fixed-rule tabs, list, add/edit, append, status change, and delete controls. Its `API_URL` is intentionally empty, so it cannot contact any Worker yet.
- The admin status control and Worker both accept `継続中`, `終了`, and `取り消し`.
- The user created an isolated Cloudflare D1 database named `chappy-memory-test` and successfully created `mother_memories`, `chappy_profile`, `fixed_rules`, and `admin_sessions` plus the two admin-session indexes. The database contains no production memory data. Cloudflare's internal `_cf_KV` table was left untouched.
- The Worker now generates fixed-rule IDs with the verified `FR` prefix and three-character numeric suffix. The local SQLite compatibility check produced the expected next IDs from test rows: `M010`, `C003`, and `FR024`.
- The Worker now creates `admin_login_attempts` lazily and limits five failed password attempts from the same client IP within a 15-minute window, followed by a 15-minute block. The lockout SQL was exercised against local SQLite; Cloudflare D1 runtime behavior remains untested.
- GitHub Actions `node --check worker.js` succeeded for the latest Worker commit. This confirms JavaScript syntax only, not Cloudflare runtime, D1, or complete security.
- A syntax check is not proof of D1 schema compatibility, runtime behavior, or complete security.
- The repository contains no authoritative D1 schema definition or migration for the existing M/C/fixed-rules tables. Actual production D1 contents and schema have not been inspected from this environment.

## Safety boundary
- `preview/index.html` points at the existing production Worker and D1. It is not an isolated test environment.
- Do not connect `preview/admin.html` to the production Worker and do not perform production writes or migrations.
- Before runtime testing, create a separate test D1 database and a separate test Worker bound only to that database. Apply `migrations/0001_admin_sessions.sql` only to the test D1.
- Fail closed if the test database binding or required tables are missing. Never silently fall back to production.
- No production Worker deployment, production D1 write/migration, or merge to `main` is authorized by this work.

## Next steps
1. Read-only confirmation of the live D1 schemas and sample IDs is complete for M, C, and fixed rules. The table list did not show an `id_counters` table; the Worker creates it lazily when the first M/C/fixed record is added.
2. Update the development Worker to generate fixed-rule IDs as `FR001...` using the verified three-character prefix, and expose all three status values in the admin page.
4. Review admin authentication protections, including failed-login abuse protection, token expiry/revocation, origin checks, and secret handling.
5. Build and bind a separate test Worker/D1. Test only against that isolated environment, including schema migration and CRUD.
6. Design conservative M/C-only memory extraction and save flow after admin CRUD is stable. Fixed rules must remain owner-curated.
7. Compare the final Worker against the supplied baseline and review all changes before requesting approval for any test deployment. Keep production `main` unchanged unless the user explicitly approves otherwise.

## Admin API design
All admin endpoints are POST and require the separate, valid, unexpired admin session except login.

### Authentication
- `POST /admin/login`: accepts `{ "password": "..." }`; checks only the existing Worker secret `CHAPPY_ADMIN_PASSWORD`; on success creates a cryptographically random bearer token, stores only its SHA-256 hash in `admin_sessions`, and returns the raw token once.
- Token lifetime is 30 minutes. Every admin request checks expiry and `revoked_at IS NULL`.
- `POST /admin/logout`: revokes the current session; browser clears its `sessionStorage` token.
- Never log passwords or raw tokens. Never store the raw token in D1, GitHub, or `localStorage`.
- Admin routes require the exact GitHub Pages Origin `https://azalea-soda.github.io`. Keep normal device-authenticated app API behavior separate.

### Record operations
- `POST /admin/records` with `{action:"list", room:"mother_memories"|"chappy_profile"|"fixed_rules"}`: lists all records, including inactive statuses.
- `create`: accepts room/category/content. M/C use the existing ID counter logic. Fixed-rule IDs must use the verified real convention; currently blocked.
- `update`: accepts room/id/category/content and updates `updated_at`.
- `append`: accepts room/id/content and appends with a newline.
- `status`: accepts room/id/status; only `継続中`, `終了`, and `取り消し` are allowed.
- `delete`: accepts room/id; the UI must require explicit confirmation.
- Resolve table names only through a hard-coded allowlist. Never interpolate a client-supplied table name.
- Validate required fields and bounded text lengths for every action.

## Test-only migration
`migrations/0001_admin_sessions.sql` creates the admin session table and indexes. The user has already created the equivalent schema manually in `chappy-memory-test`; do not rerun it blindly. Apply any future schema changes only to the isolated TEST D1 database, never production without separate explicit approval.
