import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { query, withTransaction, isDatabaseConfigured } from "@/lib/db";
import { type DispatchSnapshot } from "@/lib/dispatch-feed";
import { type DispatchRecord } from "@/lib/dispatch-shared";

type StoredIncident = {
  incident_id: string;
  content_hash: string;
  status: string | null;
};

export type DispatchEventRecord = {
  id: number;
  incidentId: string;
  fetchedAt: string;
  eventType: string;
  status: string | null;
  dispatch: DispatchRecord;
};

const RETENTION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const globalForDispatchStore = globalThis as typeof globalThis & {
  __turnoutDispatchRetentionCleanupAt?: number;
};

function logDatabaseFallback(scope: string, error: unknown) {
  const reason =
    error instanceof Error ? error.message : "Unknown database error.";
  console.error(`[dispatch-store] ${scope}`, reason);
}

export function getDispatchRetentionDays() {
  const rawValue = process.env.DISPATCH_RETENTION_DAYS?.trim() ?? "30";
  const parsedValue = Number(rawValue);

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : 30;
}

function shouldRunRetentionCleanup(now = Date.now()) {
  const lastCleanupAt =
    globalForDispatchStore.__turnoutDispatchRetentionCleanupAt ?? 0;

  if (now - lastCleanupAt < RETENTION_CLEANUP_INTERVAL_MS) {
    return false;
  }

  globalForDispatchStore.__turnoutDispatchRetentionCleanupAt = now;
  return true;
}

async function cleanupExpiredDispatchData(client: PoolClient) {
  const retentionDays = getDispatchRetentionDays();

  await client.query(
    `
      DELETE FROM dispatch_events
      WHERE fetched_at < NOW() - make_interval(days => $1)
    `,
    [retentionDays],
  );

  await client.query(
    `
      DELETE FROM dispatch_incidents
      WHERE COALESCE(last_seen_at, first_seen_at) < NOW() - make_interval(days => $1)
    `,
    [retentionDays],
  );

  await client.query(
    `
      DELETE FROM dispatch_snapshots
      WHERE fetched_at < NOW() - make_interval(days => $1)
    `,
    [retentionDays],
  );
}

function dispatchContentHash(dispatch: DispatchRecord) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        incidentNumber: dispatch.incidentNumber,
        address: dispatch.address,
        nature: dispatch.nature,
        unit: dispatch.unit,
        status: dispatch.status,
        dispatchedAt: dispatch.dispatchedAt,
        lastActivityAt: dispatch.lastActivityAt,
        message: dispatch.message,
        enrouteAt: dispatch.enrouteAt,
      }),
    )
    .digest("hex");
}

function inferEventType(
  previous: StoredIncident | undefined,
  dispatch: DispatchRecord,
  nextHash: string,
) {
  if (!previous) {
    return "created";
  }

  if (previous.content_hash === nextHash) {
    return null;
  }

  if (previous.status !== dispatch.status) {
    return "status_changed";
  }

  return "updated";
}

async function loadExistingIncidents(
  client: PoolClient,
  incidentIds: string[],
) {
  if (incidentIds.length === 0) {
    return new Map<string, StoredIncident>();
  }

  const result = await client.query<StoredIncident>(
    `
      SELECT incident_id, content_hash, status
      FROM dispatch_incidents
      WHERE incident_id = ANY($1::text[])
    `,
    [incidentIds],
  );

  return new Map(
    result.rows.map((row) => [row.incident_id, row]),
  );
}

export async function persistDispatchSnapshot(snapshot: DispatchSnapshot) {
  if (!isDatabaseConfigured()) {
    return;
  }

  const runRetentionCleanup = shouldRunRetentionCleanup();

  try {
    await withTransaction(async (client) => {
      await client.query(
        `
          INSERT INTO dispatch_snapshots (
            fetched_at,
            revision,
            configured,
            upstream_status,
            message,
            source_label,
            result
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
          ON CONFLICT (fetched_at) DO UPDATE
          SET
            revision = EXCLUDED.revision,
            configured = EXCLUDED.configured,
            upstream_status = EXCLUDED.upstream_status,
            message = EXCLUDED.message,
            source_label = EXCLUDED.source_label,
            result = EXCLUDED.result
        `,
        [
          snapshot.fetchedAt,
          snapshot.revision,
          snapshot.result.configured,
          snapshot.result.upstreamStatus,
          snapshot.result.message,
          snapshot.result.sourceLabel,
          JSON.stringify(snapshot.result),
        ],
      );

      const incidentIds = snapshot.result.dispatches.map((dispatch) => dispatch.id);
      const existingIncidents = await loadExistingIncidents(client, incidentIds);

      for (const dispatch of snapshot.result.dispatches) {
        const contentHash = dispatchContentHash(dispatch);
        const previous = existingIncidents.get(dispatch.id);
        const eventType = inferEventType(previous, dispatch, contentHash);

        await client.query(
          `
            INSERT INTO dispatch_incidents (
              incident_id,
              incident_number,
              address,
              nature,
              unit,
              status,
              dispatched_at,
              last_activity_at,
              enroute_at,
              latest_message,
              content_hash,
              raw,
              first_seen_at,
              last_seen_at,
              latest_snapshot_at
            )
            VALUES (
              $1, $2, $3, $4, $5, $6,
              NULLIF($7, '')::timestamptz,
              NULLIF($8, '')::timestamptz,
              NULLIF($9, '')::timestamptz,
              $10, $11, $12::jsonb,
              $13::timestamptz, $14::timestamptz, $15::timestamptz
            )
            ON CONFLICT (incident_id) DO UPDATE
            SET
              incident_number = EXCLUDED.incident_number,
              address = EXCLUDED.address,
              nature = EXCLUDED.nature,
              unit = EXCLUDED.unit,
              status = EXCLUDED.status,
              dispatched_at = EXCLUDED.dispatched_at,
              last_activity_at = EXCLUDED.last_activity_at,
              enroute_at = EXCLUDED.enroute_at,
              latest_message = EXCLUDED.latest_message,
              content_hash = EXCLUDED.content_hash,
              raw = EXCLUDED.raw,
              last_seen_at = EXCLUDED.last_seen_at,
              latest_snapshot_at = EXCLUDED.latest_snapshot_at
          `,
          [
            dispatch.id,
            dispatch.incidentNumber,
            dispatch.address,
            dispatch.nature,
            dispatch.unit,
            dispatch.status,
            dispatch.dispatchedAt ?? "",
            dispatch.lastActivityAt ?? "",
            dispatch.enrouteAt ?? "",
            dispatch.message,
            contentHash,
            JSON.stringify(dispatch.raw),
            snapshot.fetchedAt,
            snapshot.fetchedAt,
            snapshot.fetchedAt,
          ],
        );

        if (!eventType) {
          continue;
        }

        await client.query(
          `
            INSERT INTO dispatch_events (
              incident_id,
              fetched_at,
              event_type,
              status,
              content_hash,
              payload
            )
            VALUES ($1, $2::timestamptz, $3, $4, $5, $6::jsonb)
            ON CONFLICT (incident_id, content_hash) DO NOTHING
          `,
          [
            dispatch.id,
            snapshot.fetchedAt,
            eventType,
            dispatch.status,
            contentHash,
            JSON.stringify(dispatch),
          ],
        );
      }

      if (runRetentionCleanup) {
        await cleanupExpiredDispatchData(client);
      }
    });
  } catch (error) {
    logDatabaseFallback("persistDispatchSnapshot skipped", error);
  }
}

export async function getLatestPersistedDispatchSnapshot() {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const result = await query<{
      fetched_at: string;
      revision: number;
      result: DispatchSnapshot["result"];
    }>(
      `
        SELECT fetched_at, revision, result
        FROM dispatch_snapshots
        ORDER BY fetched_at DESC
        LIMIT 1
      `,
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      fetchedAt: new Date(row.fetched_at).toISOString(),
      revision: row.revision,
      result: row.result,
    } satisfies DispatchSnapshot;
  } catch (error) {
    logDatabaseFallback("getLatestPersistedDispatchSnapshot skipped", error);
    return null;
  }
}

export async function getPersistedIncidentsSince(sinceIso: string) {
  if (!isDatabaseConfigured()) {
    return [];
  }

  try {
    const result = await query<{
      incident_id: string;
      incident_number: string | null;
      address: string | null;
      nature: string | null;
      unit: string | null;
      status: string | null;
      dispatched_at: string | null;
      last_activity_at: string | null;
      latest_message: string | null;
      enroute_at: string | null;
      raw: unknown;
    }>(
      `
        SELECT
          incident_id,
          incident_number,
          address,
          nature,
          unit,
          status,
          dispatched_at,
          last_activity_at,
          latest_message,
          enroute_at,
          raw
        FROM dispatch_incidents
        WHERE COALESCE(dispatched_at, first_seen_at) >= $1::timestamptz
        ORDER BY COALESCE(last_activity_at, dispatched_at, first_seen_at) DESC
      `,
      [sinceIso],
    );

    return result.rows.map((row) => ({
      id: row.incident_id,
      incidentNumber: row.incident_number,
      address: row.address,
      nature: row.nature,
      unit: row.unit,
      status: row.status,
      dispatchedAt: row.dispatched_at,
      lastActivityAt: row.last_activity_at,
      message: row.latest_message,
      enrouteAt: row.enroute_at,
      raw: row.raw,
    })) satisfies DispatchRecord[];
  } catch (error) {
    logDatabaseFallback("getPersistedIncidentsSince skipped", error);
    return [];
  }
}

export async function getIncidentEvents(
  incidentId: string,
  limit = 20,
): Promise<DispatchEventRecord[]> {
  if (!isDatabaseConfigured()) {
    return [];
  }

  try {
    const result = await query<{
      id: string;
      incident_id: string;
      fetched_at: string;
      event_type: string;
      status: string | null;
      payload: unknown;
    }>(
      `
        SELECT
          id,
          incident_id,
          fetched_at,
          event_type,
          status,
          payload
        FROM dispatch_events
        WHERE incident_id = $1
        ORDER BY fetched_at DESC, id DESC
        LIMIT $2
      `,
      [incidentId, limit],
    );

    return result.rows
      .map((row) => ({
        id: Number(row.id),
        incidentId: row.incident_id,
        fetchedAt: new Date(row.fetched_at).toISOString(),
        eventType: row.event_type,
        status: row.status,
        dispatch: row.payload as DispatchRecord,
      }))
      .reverse();
  } catch (error) {
    logDatabaseFallback("getIncidentEvents skipped", error);
    return [];
  }
}
