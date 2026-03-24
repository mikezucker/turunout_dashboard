import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __turnoutDbPool?: Pool | null;
  __turnoutDbBootstrapPool?: Pool | null;
  __turnoutDbSchemaReady?: Promise<void> | null;
};

const DATABASE_STATEMENT_TIMEOUT_MS = 15000;
const DATABASE_BOOTSTRAP_STATEMENT_TIMEOUT_MS = 60000;

type DatabaseCandidate = {
  name: string;
  value: string;
};

function getDatabaseCandidate() {
  const candidates = [
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["POSTGRES_URL_NON_POOLING", process.env.POSTGRES_URL_NON_POOLING],
    ["POSTGRES_URL", process.env.POSTGRES_URL],
  ] satisfies Array<[string, string | undefined]>;

  for (const [name, candidate] of candidates) {
    const value = candidate?.trim();

    if (value) {
      return { name, value } satisfies DatabaseCandidate;
    }
  }

  return null;
}

function getDatabaseUrl() {
  return getDatabaseCandidate()?.value ?? null;
}

function getBootstrapDatabaseCandidate() {
  const candidates = [
    ["POSTGRES_URL_NON_POOLING", process.env.POSTGRES_URL_NON_POOLING],
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["POSTGRES_URL", process.env.POSTGRES_URL],
  ] satisfies Array<[string, string | undefined]>;

  for (const [name, candidate] of candidates) {
    const value = candidate?.trim();

    if (value) {
      return { name, value } satisfies DatabaseCandidate;
    }
  }

  return null;
}

function getBootstrapDatabaseUrl() {
  return getBootstrapDatabaseCandidate()?.value ?? null;
}

export function describeDatabaseTarget() {
  const candidate = getDatabaseCandidate();

  if (!candidate) {
    return "no database URL configured";
  }

  try {
    const url = new URL(candidate.value);
    const host = url.hostname || "unknown-host";
    const port = url.port || "5432";
    const databaseName = url.pathname.replace(/^\//, "") || "unknown-db";
    return `${candidate.name} -> ${host}:${port}/${databaseName}`;
  } catch {
    return `${candidate.name} -> invalid URL`;
  }
}

function getSanitizedDatabaseUrl() {
  const databaseUrl = getDatabaseUrl();

  if (!databaseUrl) {
    return null;
  }

  try {
    const url = new URL(databaseUrl);

    // node-postgres can let SSL query params from the connection string
    // override the explicit ssl config object passed to Pool.
    url.searchParams.delete("sslmode");
    url.searchParams.delete("sslcert");
    url.searchParams.delete("sslkey");
    url.searchParams.delete("sslrootcert");

    return url.toString();
  } catch {
    return databaseUrl;
  }
}

function getSanitizedBootstrapDatabaseUrl() {
  const databaseUrl = getBootstrapDatabaseUrl();

  if (!databaseUrl) {
    return null;
  }

  try {
    const url = new URL(databaseUrl);

    // node-postgres can let SSL query params from the connection string
    // override the explicit ssl config object passed to Pool.
    url.searchParams.delete("sslmode");
    url.searchParams.delete("sslcert");
    url.searchParams.delete("sslkey");
    url.searchParams.delete("sslrootcert");

    return url.toString();
  } catch {
    return databaseUrl;
  }
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
      connectionString: getSanitizedDatabaseUrl() as string,
      max: 5,
      statement_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
      ssl: {
        rejectUnauthorized: false,
      },
    });
  }

  return globalForDb.__turnoutDbPool;
}

function getBootstrapPool() {
  if (!getBootstrapDatabaseUrl()) {
    return null;
  }

  if (!globalForDb.__turnoutDbBootstrapPool) {
    globalForDb.__turnoutDbBootstrapPool = new Pool({
      connectionString: getSanitizedBootstrapDatabaseUrl() as string,
      max: 1,
      statement_timeout: DATABASE_BOOTSTRAP_STATEMENT_TIMEOUT_MS,
      ssl: {
        rejectUnauthorized: false,
      },
    });
  }

  return globalForDb.__turnoutDbBootstrapPool;
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
  const pool = getBootstrapPool() ?? getPool();
  const bootstrapStatements = [
    `
      CREATE TABLE IF NOT EXISTS dispatch_snapshots (
        fetched_at TIMESTAMPTZ PRIMARY KEY,
        revision INTEGER NOT NULL,
        configured BOOLEAN NOT NULL,
        upstream_status INTEGER NULL,
        message TEXT NULL,
        source_label TEXT NULL,
        result JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
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
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS dispatch_incidents_latest_snapshot_idx
        ON dispatch_incidents (latest_snapshot_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS dispatch_incidents_dispatched_at_idx
        ON dispatch_incidents (dispatched_at DESC)
    `,
    `
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
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS dispatch_events_incident_idx
        ON dispatch_events (incident_id, created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS dispatch_events_fetched_at_idx
        ON dispatch_events (fetched_at DESC)
    `,
  ];

  if (!pool) {
    return;
  }

  if (!globalForDb.__turnoutDbSchemaReady) {
    globalForDb.__turnoutDbSchemaReady = (async () => {
      for (const statement of bootstrapStatements) {
        await pool.query(statement);
      }
    })().catch((error) => {
      globalForDb.__turnoutDbSchemaReady = null;
      const bootstrapTarget =
        getBootstrapDatabaseCandidate()?.name ??
        getDatabaseCandidate()?.name ??
        "DATABASE_URL";
      const message =
        error instanceof Error ? error.message : "Unknown database error";
      throw new Error(
        `Database bootstrap failed (${bootstrapTarget} / ${describeDatabaseTarget()}): ${message}`,
      );
    });
  }

  return globalForDb.__turnoutDbSchemaReady;
}
