# D1 schema inspection — read-only

This document contains read-only SQL for inspecting the existing Chappy D1 database.
It does not create, update, or delete records.

## Before running

- Run these statements only in the Cloudflare D1 console for the database currently used by Chappy.
- Select the database first and confirm its name before running anything.
- Do not run any SQL containing INSERT, UPDATE, DELETE, CREATE, DROP, or ALTER as part of this inspection.
- Do not paste passwords, API keys, device tokens, or admin tokens into the SQL console or chat.

## 1. Inspect table definitions

Run this query first. It returns the stored CREATE TABLE statements for the three memory tables and the ID counter table, if present.

```sql
SELECT name, sql
FROM sqlite_master
WHERE type = 'table'
  AND name IN ('fixed_rules', 'mother_memories', 'chappy_profile', 'id_counters')
ORDER BY name;
```

## 2. Inspect fixed-rule IDs and statuses

Run only after confirming that the first query shows a `fixed_rules` table.

```sql
SELECT id, category, status
FROM fixed_rules
ORDER BY created_at ASC
LIMIT 30;
```

This is needed to determine the existing fixed-rule ID convention before enabling new fixed-rule records.

## 3. Inspect the M/C ID counter

Run only if the first query shows an `id_counters` table.

```sql
SELECT series, last_number
FROM id_counters
ORDER BY series;
```

## Safety boundary

These queries are for inspection only. Do not apply the admin-session migration, deploy a Worker, or write test records to the production database during this step. The admin feature must be tested against a separate test D1 database and test Worker first.
