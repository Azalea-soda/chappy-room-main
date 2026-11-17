# Chappy memory system v1 — implementation notes

This branch is isolated from `main`. Nothing in this branch is deployed to the production Worker or merged into the production app.

## Canonical data stores
- `mother_memories` (M): mother's feelings, opinions, meaningful memories, preferences and ongoing interests.
- `chappy_profile` (C): Chappy's own likes, experiences and developing profile.
- `fixed_rules`: identity, tone, promises and absolute behavior rules. These are curated by the administrator only and are never auto-generated from ordinary conversation.

The existing record shape remains `id, category, content, created_at, updated_at`, with the already-used `status` field retained. Do not add importance or frequency scores.

## Required behavior
1. Conversation memory collection may propose/save only clear, useful M or C facts. It must not write fixed rules.
2. Do not save guesses, transient small talk, sensitive details, passwords, or full conversation transcripts.
3. Preserve corrections: a clear correction should update the relevant existing memory, retaining the correction/history in the content when appropriate rather than silently losing the old context.
4. Avoid duplicates. If the classification or whether something is worth remembering is uncertain, do not save it automatically.
5. The administrator must be able to view, add, edit, append, deactivate/reactivate, and delete records in all three rooms after the app has been handed to the mother.
6. Reuse the existing `CHAPPY_ADMIN_PASSWORD` secret. Do not introduce another password and never put the password in frontend code or GitHub.
7. The mother's device token and administrator session are separate credentials. The admin session is short-lived and stored only in sessionStorage.
8. Never run write tests against production D1. The preview currently calls the same production Worker/D1 as the live app, so it is not a safe isolated write-test environment.

## Current implementation state
- Existing Worker pasted by the developer supports device-authenticated list/create/status/append for M and C, and list-only for fixed rules.
- Existing preview frontend reads all three D1 tables but does not save conversation memories.
- `preview/admin.html` now includes add, edit, append, status, delete, login, and logout UI flows. Its API URL remains intentionally empty until a separate test Worker is ready.
- `worker.js` has been added on this development branch based on the 409-line Worker source supplied by the user. It includes separate admin login/session validation and allowlisted admin record operations while retaining the existing device-authenticated app routes and Groq streaming path.
- The admin Worker draft must not be deployed yet. The `fixed_rules` ID convention and exact D1 schema have not been verified; the current draft uses a provisional UUID-style `F-` ID for new fixed rules.
- No Worker deployment, D1 migration, production write, or merge to main is authorized by this branch work.
- Before any live test, establish a separate test D1 database and bind it only to the test Worker, or provide another verified isolation boundary.

## Next steps
1. Add and review admin-only Worker routes with hashed, expiring sessions issued after checking the existing admin password.
2. Add admin CRUD for M, C, and fixed rules using an allowlist of table names.
3. Add conservative M/C-only memory extraction and save flow, with validation and duplicate/update handling.
4. Test syntax and logic offline; then plan a separate D1 test binding before any network write test.
5. Only after the user explicitly approves, deploy the test Worker and test app. Keep production `main` unchanged until all checks pass.


## Admin API contract (design; not yet implemented)
All admin routes are POST endpoints. They must reject requests unless the caller has a valid, unexpired admin session. They must never accept a mother's device token as an admin credential.

### Authentication
- `POST /admin/login`: accept `{ "password": "..." }`; compare only against the existing Worker secret `CHAPPY_ADMIN_PASSWORD`; on success generate a cryptographically random bearer token, store only its SHA-256 hash in `admin_sessions`, and return the raw token once.
- Admin token lifetime: 30 minutes. Check expiry and `revoked_at IS NULL` on every admin request.
- `POST /admin/logout`: revoke the current session in D1; the browser then clears its sessionStorage token.
- Never log passwords or raw tokens. Never store the raw token in D1, GitHub, or localStorage.
- Admin routes must validate the exact GitHub Pages Origin `https://azalea-soda.github.io` (and reject missing or other Origins for browser requests). Keep the existing normal app API behavior separate; do not globally break device-authenticated requests.

### Records
- `POST /admin/records` with `{action:"list", room:"mother_memories"|"chappy_profile"|"fixed_rules"}`: list all records, including inactive statuses, so the owner can review and restore them.
- `create`: accept `room, category, content`; generate the existing M/C IDs using the existing counter logic. Fixed-rule IDs must be generated using the actual existing fixed_rules schema/ID convention after inspecting it; do not guess.
- `update`: accept `room, id, category, content`; update category/content and updated_at.
- `append`: accept `room, id, content`; append with a newline and update updated_at.
- `status`: accept `room, id, status`; allow only the existing statuses `継続中`, `終了`, `取り消し`.
- `delete`: accept `room, id`; permanently delete only after the UI's explicit confirmation.
- Resolve the table only through a hard-coded allowlist. Never interpolate a client-supplied table name.
- Every action must validate required fields and bounded text lengths, and return consistent JSON errors.

### Browser page follow-ups
- Keep API_URL empty until a separate test Worker URL is explicitly configured.
- Add an append action to the record UI (it is currently missing).
- Make logout call `/admin/logout` before clearing sessionStorage.
- Show inactive records in the admin list and allow restoring them.
- Keep the password only in the login input for the duration of login; clear it immediately afterward.

### Test boundary
- The preview site shares the production origin and currently points at the production Worker for normal app functions. Do not use it for write tests.
- Create a separate test Worker and separate test D1 binding before any admin write test. Apply `migrations/0001_admin_sessions.sql` only to that test D1 first.
- Verify the existing D1 table schemas (especially `fixed_rules` and `id_counters`) before implementing fixed-rule create/update/delete or applying any migration.
- No production Worker deployment, production D1 write/migration, or merge to `main` is authorized by this development work.


## Latest code review notes
- The shared M/C ID generator is defined before the admin route handler so the admin create action can call it safely.
- The admin browser page sends logout to the Worker to revoke the session, and now exposes an append action.
- A GitHub Actions workflow runs `node --check worker.js` on changes to this branch.
- Do not treat a passing syntax check as proof of D1 compatibility or security. Runtime tests require an isolated Worker and isolated D1 database.
- Before testing, inspect the actual `fixed_rules` schema and existing ID values. Replace the provisional fixed-rule ID generator if the table uses another convention.
- Admin CORS currently checks the GitHub Pages origin on admin POST routes; verify the actual published admin page origin and ensure preflight behavior matches it before test deployment.
- The user-supplied source is the reference for preserving existing app behavior. Compare the final Worker diff against it before any deployment.
