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
- `preview/admin.html` is an administrator UI draft that expects `/admin/login` and `/admin/records`. Those Worker endpoints must be implemented and reviewed before the page can function.
- No Worker deployment, D1 migration, production write, or merge to main is authorized by this branch work.
- Before any live test, establish a separate test D1 database and bind it only to the test Worker, or provide another verified isolation boundary.

## Next steps
1. Add and review admin-only Worker routes with hashed, expiring sessions issued after checking the existing admin password.
2. Add admin CRUD for M, C, and fixed rules using an allowlist of table names.
3. Add conservative M/C-only memory extraction and save flow, with validation and duplicate/update handling.
4. Test syntax and logic offline; then plan a separate D1 test binding before any network write test.
5. Only after the user explicitly approves, deploy the test Worker and test app. Keep production `main` unchanged until all checks pass.
