-- Removes dispatch rows that the app no longer uses under the current
-- retention model. This matches the cleanup logic in src/lib/dispatch-store.ts.
--
-- Edit the value in `params.retention_days` before running.
-- This version is plain Postgres SQL, so it works in SQL editors too.
--
-- Usage:
--   1. Set `retention_days` in the CTE below.
--   2. Run the script.
--
-- Notes:
-- - `dispatch_events.incident_id` has ON DELETE CASCADE, but this script also
--   trims old events explicitly so it can be run before incident cleanup.

BEGIN;

WITH params AS (
  SELECT 30::integer AS retention_days
)
DELETE FROM dispatch_events
WHERE fetched_at < NOW() - make_interval(
  days => (SELECT retention_days FROM params)
);

WITH params AS (
  SELECT 30::integer AS retention_days
)
DELETE FROM dispatch_incidents
WHERE COALESCE(last_seen_at, first_seen_at) < NOW() - make_interval(
  days => (SELECT retention_days FROM params)
);

WITH params AS (
  SELECT 30::integer AS retention_days
)
DELETE FROM dispatch_snapshots
WHERE fetched_at < NOW() - make_interval(
  days => (SELECT retention_days FROM params)
);

COMMIT;
