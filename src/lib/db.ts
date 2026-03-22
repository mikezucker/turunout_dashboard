import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __turnoutDbPool?: Pool | null;
  __turnoutDbSchemaReady?: Promise<void> | null;
};

function getDatabaseUrl() {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();

    if (value) {
      return value;
    }
  }

  return null;
}

export function isDatabaseConfigured() {
  return getDatabaseUrl() !== null;
}

function getPool() {
  if (!isDatabaseConfigured()) {
    return null;
  }

  if (!globalForDb.__turnoutDbPool) {
    globalForDb.__turnoutDbPool = new Pool({
      connectionString: getDatabaseUrl() as string,
      max: 5,
    });
  }

  return globalForDb.__turnoutDbPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  await ensureDatabaseSchema();
  return pool.query<T>(sql, params);
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
) {
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  await ensureDatabaseSchema();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureDatabaseSchema() {
  const pool = getPool();

  if (!pool) {
    return;
  }

  if (!globalForDb.__turnoutDbSchemaReady) {
    globalForDb.__turnoutDbSchemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS dispatch_snapshots (
          fetched_at TIMESTAMPTZ PRIMARY KEY,
          revision INTEGER NOT NULL,
          configured BOOLEAN NOT NULL,
          upstream_status INTEGER NULL,
          message TEXT NULL,
          source_label TEXT NULL,
          result JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS dispatch_incidents (
          incident_id TEXT PRIMARY KEY,
          incident_number TEXT NULL,
          address TEXT NULL,
          nature TEXT NULL,
          unit TEXT NULL,
          status TEXT NULL,
          dispatched_at TIMESTAMPTZ NULL,
          last_activity_at TIMESTAMPTZ NULL,
          enroute_at TIMESTAMPTZ NULL,
          latest_message TEXT NULL,
          content_hash TEXT NOT NULL,
          raw JSONB NOT NULL,
          first_seen_at TIMESTAMPTZ NOT NULL,
          last_seen_at TIMESTAMPTZ NOT NULL,
          latest_snapshot_at TIMESTAMPTZ NOT NULL
        );

        CREATE INDEX IF NOT EXISTS dispatch_incidents_latest_snapshot_idx
          ON dispatch_incidents (latest_snapshot_at DESC);
        CREATE INDEX IF NOT EXISTS dispatch_incidents_dispatched_at_idx
          ON dispatch_incidents (dispatched_at DESC);

        CREATE TABLE IF NOT EXISTS dispatch_events (
          id BIGSERIAL PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES dispatch_incidents(incident_id) ON DELETE CASCADE,
          fetched_at TIMESTAMPTZ NOT NULL,
          event_type TEXT NOT NULL,
          status TEXT NULL,
          content_hash TEXT NOT NULL,
          payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (incident_id, content_hash)
        );

        CREATE INDEX IF NOT EXISTS dispatch_events_incident_idx
          ON dispatch_events (incident_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS dispatch_events_fetched_at_idx
          ON dispatch_events (fetched_at DESC);
      `);
    })().catch((error) => {
      globalForDb.__turnoutDbSchemaReady = null;
      throw error;
    });
  }

  return globalForDb.__turnoutDbSchemaReady;
}
