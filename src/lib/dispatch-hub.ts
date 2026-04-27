import crypto from "node:crypto";
import { once } from "node:events";
import Redis from "ioredis";
import { isDatabaseConfigured, describeDatabaseTarget } from "@/lib/db";
import {
  fetchFirstDueDispatches,
  type DispatchFetchResult,
} from "@/lib/dispatches";
import { type DispatchSnapshot } from "@/lib/dispatch-feed";
import {
  getDispatchRetentionDays,
  getLatestPersistedDispatchSnapshot,
  persistDispatchSnapshot,
} from "@/lib/dispatch-store";

// 🚨 ADD THIS HELPER (leave everything else untouched below)
async function sendDispatchAlertWebhook(
  dispatch: DispatchFetchResult["dispatches"][number]
) {
  const webhookUrl = process.env.DISPATCH_ALERT_WEBHOOK_URL;
  const token = process.env.DISPATCH_ALERT_WEBHOOK_TOKEN;
  if (!webhookUrl || !token) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        dispatchId: dispatch.id,
        callType: dispatch.nature ?? dispatch.message ?? "Dispatch",
        address: dispatch.address ?? null,
        units: dispatch.unit ? [dispatch.unit] : [],
      }),
    });
  } catch (err) {
    console.error("[dispatch-hub] webhook failed", err);
  }
}

type DispatchListener = (snapshot: DispatchSnapshot) => void;

type DispatchHubState = {
  inFlight: Promise<DispatchSnapshot> | null;
  intervalId: NodeJS.Timeout | null;
  listeners: Set<DispatchListener>;
  revision: number;
  snapshot: DispatchSnapshot | null;
  signature: string | null;
  redis: RedisState | null;
  consecutiveFailureCount: number;
  lastScheduledPollIntervalMs: number | null;
  telemetry: DispatchHubTelemetry;
};

type DispatchHubTelemetry = {
  lastRefreshStartedAt: string | null;
  lastRefreshCompletedAt: string | null;
  lastSuccessfulFetchAt: string | null;
  lastFetchDurationMs: number | null;
  lastPersistDurationMs: number | null;
  lastPersistError: string | null;
  lastRefreshDurationMs: number | null;
  lastError: string | null;
  lastResultMessage: string | null;
  lastUpstreamStatus: number | null;
  lastPollIntervalMs?: number | null;
  consecutiveFailureCount?: number;
};

type RedisState = {
  client: Redis;
  instanceId: string;
  publisher: Redis;
  subscriber: Redis;
  subscriptionReady: Promise<void> | null;
  subscribed: boolean;
};

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_LOCK_TTL_MS = 15000;
const MIN_REQUEST_REFRESH_INTERVAL_MS = 15000;
const DEFAULT_MAX_BACKOFF_POLL_INTERVAL_MS = 60000;
const POLL_JITTER_RATIO = 0.15;
const globalForDispatchHub = globalThis as typeof globalThis & {
  __turnoutDispatchHub?: DispatchHubState;
};

function getPollIntervalMs() {
  const rawValue =
    process.env.FIRSTDUE_POLL_INTERVAL_MS ??
    process.env.NEXT_PUBLIC_POLL_INTERVAL_MS ??
    String(DEFAULT_POLL_INTERVAL_MS);
  const parsedValue = Number(rawValue);

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : DEFAULT_POLL_INTERVAL_MS;
}

function parsePositiveNumber(rawValue: string | undefined, fallback: number) {
  const parsedValue = Number(rawValue);

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
}

function getMaxBackoffPollIntervalMs() {
  return Math.max(
    parsePositiveNumber(
      process.env.FIRSTDUE_MAX_BACKOFF_POLL_INTERVAL_MS,
      DEFAULT_MAX_BACKOFF_POLL_INTERVAL_MS,
    ),
    getPollIntervalMs(),
  );
}

function getPollLockTtlMs() {
  const rawValue =
    process.env.FIRSTDUE_POLL_LOCK_TTL_MS ?? String(DEFAULT_LOCK_TTL_MS);
  const parsedValue = Number(rawValue);

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : DEFAULT_LOCK_TTL_MS;
}

function getRedisUrl() {
  const value = process.env.REDIS_URL?.trim();
  return value ? value : null;
}

function getRedisKeyPrefix() {
  const value = process.env.REDIS_KEY_PREFIX?.trim();
  return value ? value : "turnout";
}

function redisSnapshotKey() {
  return `${getRedisKeyPrefix()}:dispatch:snapshot`;
}

function redisChannelName() {
  return `${getRedisKeyPrefix()}:dispatch:updates`;
}

function redisLockKey() {
  return `${getRedisKeyPrefix()}:dispatch:poll-lock`;
}

function createFallbackResult(error: unknown): DispatchFetchResult {
  const message =
    error instanceof Error ? error.message : "Unknown polling error";

  return {
    configured: true,
    upstreamStatus: 502,
    dispatches: [],
    message,
    sourceLabel: null,
  };
}

function buildDispatchSignature(result: DispatchFetchResult) {
  return JSON.stringify({
    configured: result.configured,
    upstreamStatus: result.upstreamStatus,
    message: result.message,
    sourceLabel: result.sourceLabel,
    dispatches: result.dispatches.map((dispatch) => ({
      id: dispatch.id,
      incidentNumber: dispatch.incidentNumber,
      address: dispatch.address,
      nature: dispatch.nature,
      unit: dispatch.unit,
      status: dispatch.status,
      dispatchedAt: dispatch.dispatchedAt,
      lastActivityAt: dispatch.lastActivityAt,
      message: dispatch.message,
      enrouteAt: dispatch.enrouteAt,
    })),
  });
}

function getDispatchHubState(): DispatchHubState {
  if (!globalForDispatchHub.__turnoutDispatchHub) {
    globalForDispatchHub.__turnoutDispatchHub = {
      inFlight: null,
      intervalId: null,
      listeners: new Set(),
      revision: 0,
      snapshot: null,
      signature: null,
      redis: null,
      consecutiveFailureCount: 0,
      lastScheduledPollIntervalMs: null,
      telemetry: {
        lastRefreshStartedAt: null,
        lastRefreshCompletedAt: null,
        lastSuccessfulFetchAt: null,
        lastFetchDurationMs: null,
        lastPersistDurationMs: null,
        lastPersistError: null,
        lastRefreshDurationMs: null,
        lastError: null,
        lastResultMessage: null,
        lastUpstreamStatus: null,
      },
    };
  }

  return globalForDispatchHub.__turnoutDispatchHub;
}

function publishSnapshot(state: DispatchHubState, snapshot: DispatchSnapshot) {
  for (const listener of state.listeners) {
    listener(snapshot);
  }
}

function parseDispatchSnapshot(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as DispatchSnapshot;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.fetchedAt !== "string" ||
      typeof parsed.revision !== "number" ||
      !parsed.result ||
      typeof parsed.result !== "object" ||
      !Array.isArray(parsed.result.dispatches)
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function isSuccessfulSnapshot(snapshot: DispatchSnapshot | null) {
  if (!snapshot) {
    return false;
  }

  const status = snapshot.result.upstreamStatus;

  return typeof status === "number" && status >= 200 && status < 300;
}

function snapshotAgeMs(snapshot: DispatchSnapshot | null, now = Date.now()) {
  if (!snapshot) {
    return null;
  }

  const fetchedAt = Date.parse(snapshot.fetchedAt);

  if (Number.isNaN(fetchedAt)) {
    return null;
  }

  return Math.max(0, now - fetchedAt);
}

function requestRefreshThresholdMs() {
  return Math.max(getPollIntervalMs() * 2, MIN_REQUEST_REFRESH_INTERVAL_MS);
}

function shouldRefreshSnapshotOnRequest(snapshot: DispatchSnapshot | null) {
  const ageMs = snapshotAgeMs(snapshot);

  if (ageMs === null) {
    return snapshot === null;
  }

  return ageMs >= requestRefreshThresholdMs();
}

function isSuccessfulResult(result: DispatchFetchResult) {
  const status = result.upstreamStatus;

  return typeof status === "number" && status >= 200 && status < 300;
}

function applyPollJitter(intervalMs: number) {
  const jitterWindowMs = Math.round(intervalMs * POLL_JITTER_RATIO);

  if (jitterWindowMs <= 0) {
    return intervalMs;
  }

  const jitterOffsetMs = Math.round((Math.random() * 2 - 1) * jitterWindowMs);

  return Math.max(1000, intervalMs + jitterOffsetMs);
}

function nextPollIntervalMs(state: DispatchHubState) {
  const baseIntervalMs = getPollIntervalMs();
  const maxBackoffIntervalMs = getMaxBackoffPollIntervalMs();

  if (state.consecutiveFailureCount > 0) {
    const backedOffIntervalMs = Math.min(
      maxBackoffIntervalMs,
      baseIntervalMs * 2 ** Math.min(state.consecutiveFailureCount, 6),
    );

    return applyPollJitter(backedOffIntervalMs);
  }

  return applyPollJitter(baseIntervalMs);
}

function scheduleNextDispatchRefresh(state: DispatchHubState) {
  if (state.intervalId) {
    clearTimeout(state.intervalId);
  }

  const intervalMs = nextPollIntervalMs(state);
  state.lastScheduledPollIntervalMs = intervalMs;
  state.intervalId = setTimeout(() => {
    state.intervalId = null;
    void refreshDispatchSnapshot();
  }, intervalMs);
}

function applySnapshot(
  state: DispatchHubState,
  snapshot: DispatchSnapshot,
  shouldNotify: boolean,
) {
  const nextSignature = buildDispatchSignature(snapshot.result);
  const previousRevision = state.snapshot?.revision ?? null;

  state.snapshot = snapshot;
  state.revision = snapshot.revision;
  state.signature = nextSignature;

  if (isSuccessfulSnapshot(snapshot)) {
    const previousSuccessAt = state.telemetry.lastSuccessfulFetchAt
      ? Date.parse(state.telemetry.lastSuccessfulFetchAt)
      : NaN;
    const snapshotFetchedAt = Date.parse(snapshot.fetchedAt);

    if (
      Number.isFinite(snapshotFetchedAt) &&
      (!Number.isFinite(previousSuccessAt) || snapshotFetchedAt > previousSuccessAt)
    ) {
      state.telemetry.lastSuccessfulFetchAt = snapshot.fetchedAt;
    }
  }

  if (shouldNotify && previousRevision !== snapshot.revision) {
    publishSnapshot(state, snapshot);
  }
}

function getRedisState(state: DispatchHubState) {
  if (state.redis) {
    return state.redis;
  }

  const redisUrl = getRedisUrl();

  if (!redisUrl) {
    return null;
  }

  const client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const publisher = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  const subscriber = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });

  state.redis = {
    client,
    instanceId: crypto.randomUUID(),
    publisher,
    subscriber,
    subscriptionReady: null,
    subscribed: false,
  };

  return state.redis;
}

async function ensureRedisConnection(client: Redis) {
  if (client.status === "ready") {
    return;
  }

  if (client.status === "wait" || client.status === "end") {
    await client.connect();
    return;
  }

  if (client.status === "connecting" || client.status === "connect") {
    await once(client, "ready");
  }
}

async function ensureRedisSubscription(state: DispatchHubState) {
  const redis = getRedisState(state);

  if (!redis) {
    return;
  }

  if (redis.subscribed) {
    return;
  }

  if (redis.subscriptionReady) {
    return redis.subscriptionReady;
  }

  redis.subscriptionReady = (async () => {
    await ensureRedisConnection(redis.subscriber);
    redis.subscriber.on("message", (_channel, message) => {
      const snapshot = parseDispatchSnapshot(message);

      if (!snapshot) {
        return;
      }

      applySnapshot(state, snapshot, true);
    });
    await redis.subscriber.subscribe(redisChannelName());
    redis.subscribed = true;
    await ensureRedisConnection(redis.client);

    const storedSnapshot = parseDispatchSnapshot(
      await redis.client.get(redisSnapshotKey()),
    );

    if (storedSnapshot) {
      applySnapshot(state, storedSnapshot, false);
    }
  })().catch((error) => {
    redis.subscriptionReady = null;
    throw error;
  });

  return redis.subscriptionReady;
}

async function loadRedisSnapshot(state: DispatchHubState) {
  const redis = getRedisState(state);

  if (!redis) {
    return null;
  }

  await ensureRedisConnection(redis.client);

  const snapshot = parseDispatchSnapshot(await redis.client.get(redisSnapshotKey()));

  if (snapshot) {
    applySnapshot(state, snapshot, false);
  }

  return snapshot;
}

async function acquirePollLease(state: DispatchHubState) {
  const redis = getRedisState(state);

  if (!redis) {
    return true;
  }

  await ensureRedisConnection(redis.client);

  const result = await redis.client.eval(
    `
      local current = redis.call("GET", KEYS[1])
      if current == ARGV[1] then
        redis.call("PEXPIRE", KEYS[1], ARGV[2])
        return 1
      end

      local acquired = redis.call("SET", KEYS[1], ARGV[1], "NX", "PX", ARGV[2])
      if acquired then
        return 1
      end

      return 0
    `,
    1,
    redisLockKey(),
    redis.instanceId,
    String(getPollLockTtlMs()),
  );

  return Number(result) === 1;
}

async function persistRedisSnapshot(
  state: DispatchHubState,
  result: DispatchFetchResult,
) {
  const persistStartedAt = Date.now();
  const redis = getRedisState(state);

  if (!redis) {
    const currentSignature = state.signature;
    const nextSignature = buildDispatchSignature(result);
    const nextRevision =
      currentSignature === nextSignature ? state.revision : state.revision + 1;
    const snapshot: DispatchSnapshot = {
      fetchedAt: new Date().toISOString(),
      revision: nextRevision,
      result,
    };

    applySnapshot(state, snapshot, true);
    try {
      await persistDispatchSnapshot(snapshot);
      state.telemetry.lastPersistDurationMs = Date.now() - persistStartedAt;
      state.telemetry.lastPersistError = null;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Dispatch persistence failed.";
      state.telemetry.lastPersistDurationMs = null;
      state.telemetry.lastPersistError = message;
      console.error("[dispatch-hub] persist failed", message);
    }
    return snapshot;
  }

  await ensureRedisConnection(redis.client);
  await ensureRedisConnection(redis.publisher);

  const currentSnapshot = parseDispatchSnapshot(
    await redis.client.get(redisSnapshotKey()),
  );
  const currentSignature = currentSnapshot
    ? buildDispatchSignature(currentSnapshot.result)
    : null;
  const nextSignature = buildDispatchSignature(result);
  const shouldPublish = currentSignature !== nextSignature;

  // 🚨 NEW DISPATCH DETECTION
if (shouldPublish && isSuccessfulResult(result)) {
  const previousIds = new Set(
    currentSnapshot?.result.dispatches.map((d) => d.id) ?? []
  );
  const newDispatches = result.dispatches.filter(
    (d) => d.id && !previousIds.has(d.id)
  );
  if (newDispatches.length > 0) {
    console.log(
      "[dispatch-hub] new dispatches:",
      newDispatches.map((d) => d.id)
    );
  }
  await Promise.allSettled(
    newDispatches.map((d) => sendDispatchAlertWebhook(d))
  );
}
  const snapshot: DispatchSnapshot = {
    fetchedAt: new Date().toISOString(),
    revision:
      shouldPublish
        ? (currentSnapshot?.revision ?? 0) + 1
        : currentSnapshot?.revision ?? 0,
    result,
  };
  const serializedSnapshot = JSON.stringify(snapshot);

  await redis.client.set(redisSnapshotKey(), serializedSnapshot);
  if (shouldPublish) {
    await redis.publisher.publish(redisChannelName(), serializedSnapshot);
  }
  applySnapshot(state, snapshot, shouldPublish);
  try {
    await persistDispatchSnapshot(snapshot);
    state.telemetry.lastPersistDurationMs = Date.now() - persistStartedAt;
    state.telemetry.lastPersistError = null;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dispatch persistence failed.";
    state.telemetry.lastPersistDurationMs = null;
    state.telemetry.lastPersistError = message;
    console.error("[dispatch-hub] persist failed", message);
  }

  return snapshot;
}

async function fetchAndPersistSnapshot(state: DispatchHubState) {
  let result: DispatchFetchResult;
  const refreshStartedAt = Date.now();
  state.telemetry.lastRefreshStartedAt = new Date(refreshStartedAt).toISOString();

  try {
    const fetchStartedAt = Date.now();
    result = await fetchFirstDueDispatches();
    state.telemetry.lastFetchDurationMs = Date.now() - fetchStartedAt;
  } catch (error) {
    state.telemetry.lastFetchDurationMs =
      Date.now() - refreshStartedAt;
    result = createFallbackResult(error);
  }

  const snapshot = await persistRedisSnapshot(state, result);
  const completedAt = new Date().toISOString();

  state.telemetry.lastRefreshCompletedAt = completedAt;
  state.telemetry.lastRefreshDurationMs = Date.now() - refreshStartedAt;
  state.telemetry.lastUpstreamStatus = result.upstreamStatus;
  state.telemetry.lastResultMessage = result.message;
  state.telemetry.lastError = state.telemetry.lastPersistError
    ? state.telemetry.lastPersistError
    : result.upstreamStatus && result.upstreamStatus >= 200 && result.upstreamStatus < 300
      ? null
      : result.message;

  state.consecutiveFailureCount = isSuccessfulResult(result)
    ? 0
    : state.consecutiveFailureCount + 1;

  if (result.upstreamStatus && result.upstreamStatus >= 200 && result.upstreamStatus < 300) {
    state.telemetry.lastSuccessfulFetchAt = completedAt;
  }

  return snapshot;
}

async function refreshWithSharedStore(state: DispatchHubState) {
  const redis = getRedisState(state);

  if (!redis) {
    return fetchAndPersistSnapshot(state);
  }

  await ensureRedisSubscription(state);

  if (await acquirePollLease(state)) {
    return fetchAndPersistSnapshot(state);
  }

  const snapshot = await loadRedisSnapshot(state);

  if (snapshot) {
    return snapshot;
  }

  return fetchAndPersistSnapshot(state);
}

export function ensureDispatchPolling() {
  const state = getDispatchHubState();

  if (state.intervalId) {
    return;
  }

  void ensureRedisSubscription(state).catch(() => {
    return;
  });
  void refreshDispatchSnapshot();
}

export async function refreshDispatchSnapshot() {
  const state = getDispatchHubState();

  if (state.inFlight) {
    return state.inFlight;
  }

  state.inFlight = refreshWithSharedStore(state).finally(() => {
    state.inFlight = null;
    scheduleNextDispatchRefresh(state);
  });

  return state.inFlight;
}

export async function getDispatchSnapshot() {
  ensureDispatchPolling();

  const state = getDispatchHubState();

  if (state.snapshot) {
    if (shouldRefreshSnapshotOnRequest(state.snapshot)) {
      try {
        return await refreshDispatchSnapshot();
      } catch {
        return state.snapshot;
      }
    }

    return state.snapshot;
  }

  const persistedSnapshot = await getLatestPersistedDispatchSnapshot();

  if (persistedSnapshot) {
    applySnapshot(state, persistedSnapshot, false);

    if (shouldRefreshSnapshotOnRequest(persistedSnapshot)) {
      try {
        return await refreshDispatchSnapshot();
      } catch {
        return persistedSnapshot;
      }
    }

    return persistedSnapshot;
  }

  const redisSnapshot = await loadRedisSnapshot(state);

  if (redisSnapshot) {
    if (shouldRefreshSnapshotOnRequest(redisSnapshot)) {
      try {
        return await refreshDispatchSnapshot();
      } catch {
        return redisSnapshot;
      }
    }

    return redisSnapshot;
  }

  return refreshDispatchSnapshot();
}

export function subscribeToDispatches(listener: DispatchListener) {
  const state = getDispatchHubState();

  ensureDispatchPolling();
  state.listeners.add(listener);

  return () => {
    state.listeners.delete(listener);
  };
}

export function getDispatchHubHealth() {
  const state = getDispatchHubState();
  const redis = state.redis;

  return {
    ok: true,
    pollIntervalMs: getPollIntervalMs(),
    lockTtlMs: getPollLockTtlMs(),
    retentionDays: getDispatchRetentionDays(),
    listeners: state.listeners.size,
    revision: state.snapshot?.revision ?? state.revision,
    snapshotFetchedAt: state.snapshot?.fetchedAt ?? null,
    snapshotUpstreamStatus: state.snapshot?.result.upstreamStatus ?? null,
    snapshotSourceLabel: state.snapshot?.result.sourceLabel ?? null,
    database: {
      configured: isDatabaseConfigured(),
      target: isDatabaseConfigured() ? describeDatabaseTarget() : null,
    },
    redis: {
      configured: Boolean(getRedisUrl()),
      subscribed: redis?.subscribed ?? false,
      clientStatus: redis?.client.status ?? "disabled",
      publisherStatus: redis?.publisher.status ?? "disabled",
      subscriberStatus: redis?.subscriber.status ?? "disabled",
    },
    telemetry: {
      ...state.telemetry,
      lastPollIntervalMs: state.lastScheduledPollIntervalMs,
      consecutiveFailureCount: state.consecutiveFailureCount,
    },
  };
}
