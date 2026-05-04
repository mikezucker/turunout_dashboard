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

async function sendDispatchAlertWebhook(
  dispatch: DispatchFetchResult["dispatches"][number]
) {
  const webhookUrl = process.env.DISPATCH_ALERT_WEBHOOK_URL?.trim();
  const token = process.env.DISPATCH_ALERT_WEBHOOK_TOKEN?.trim();

  if (!webhookUrl || !token) {
    console.warn("[dispatch-hub] webhook skipped: missing URL or token");
    return;
  }

  const units =
    typeof dispatch.unit === "string"
      ? dispatch.unit
          .split(",")
          .map((unit) => unit.trim())
          .filter(Boolean)
      : [];

  try {
    console.log("[dispatch-hub] sending webhook for dispatch:", dispatch.id);

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        dispatchId: dispatch.id,
        callType: dispatch.nature ?? dispatch.message ?? "Dispatch",
        address: dispatch.address ?? null,
        units,
      }),
    });

    const responseText = await response.text().catch(() => "");

    console.log("[dispatch-hub] webhook response:", {
      dispatchId: dispatch.id,
      status: response.status,
      ok: response.ok,
      body: responseText.slice(0, 500),
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

const DEFAULT_POLL_INTERVAL_MS = 2000;
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
      DEFAULT_MAX_BACKOFF_POLL_INTERVAL_MS
    ),
    getPollIntervalMs()
  );
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

function isSuccessfulSnapshot(snapshot: DispatchSnapshot | null) {
  if (!snapshot) return false;

  const status = snapshot.result.upstreamStatus;
  return typeof status === "number" && status >= 200 && status < 300;
}

function snapshotAgeMs(snapshot: DispatchSnapshot | null, now = Date.now()) {
  if (!snapshot) return null;

  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (Number.isNaN(fetchedAt)) return null;

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
  if (jitterWindowMs <= 0) return intervalMs;

  const jitterOffsetMs = Math.round((Math.random() * 2 - 1) * jitterWindowMs);
  return Math.max(1000, intervalMs + jitterOffsetMs);
}

function nextPollIntervalMs(state: DispatchHubState) {
  const baseIntervalMs = getPollIntervalMs();
  const maxBackoffIntervalMs = getMaxBackoffPollIntervalMs();

  if (state.consecutiveFailureCount > 0) {
    const backedOffIntervalMs = Math.min(
      maxBackoffIntervalMs,
      baseIntervalMs * 2 ** Math.min(state.consecutiveFailureCount, 6)
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
  shouldNotify: boolean
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
      (!Number.isFinite(previousSuccessAt) ||
        snapshotFetchedAt > previousSuccessAt)
    ) {
      state.telemetry.lastSuccessfulFetchAt = snapshot.fetchedAt;
    }
  }

  if (shouldNotify && previousRevision !== snapshot.revision) {
    publishSnapshot(state, snapshot);
  }
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

async function notifyForNewDispatches(
  previousSnapshot: DispatchSnapshot | null,
  result: DispatchFetchResult
) {
  if (!isSuccessfulResult(result)) {
    return;
  }

  const previousIds = new Set(
    previousSnapshot?.result.dispatches
      .map((dispatch) => dispatch.id)
      .filter(Boolean) ?? []
  );

  const newDispatches = result.dispatches.filter(
    (dispatch) => dispatch.id && !previousIds.has(dispatch.id)
  );

  if (newDispatches.length === 0) {
    console.log("[dispatch-hub] no new dispatches detected");
    return;
  }

  console.log(
    "[dispatch-hub] new dispatches detected:",
    newDispatches.map((dispatch) => dispatch.id)
  );

  const results = await Promise.allSettled(
    newDispatches.map((dispatch) => sendDispatchAlertWebhook(dispatch))
  );

  const failedCount = results.filter((result) => result.status === "rejected").length;

  if (failedCount > 0) {
    console.warn("[dispatch-hub] webhook failures:", failedCount);
  }
}

async function persistDatabaseSnapshot(
  state: DispatchHubState,
  result: DispatchFetchResult
) {
  const persistStartedAt = Date.now();

  const previousSnapshot = await getLatestPersistedDispatchSnapshot();
  const previousSignature = previousSnapshot
    ? buildDispatchSignature(previousSnapshot.result)
    : state.signature;

  const nextSignature = buildDispatchSignature(result);
  const shouldPublish = previousSignature !== nextSignature;

  await notifyForNewDispatches(previousSnapshot, result);

  const snapshot: DispatchSnapshot = {
    fetchedAt: new Date().toISOString(),
    revision: shouldPublish
      ? (previousSnapshot?.revision ?? state.revision ?? 0) + 1
      : previousSnapshot?.revision ?? state.revision ?? 0,
    result,
  };

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
  state.telemetry.lastRefreshStartedAt = new Date(
    refreshStartedAt
  ).toISOString();

  try {
    const fetchStartedAt = Date.now();
    result = await fetchFirstDueDispatches();
    state.telemetry.lastFetchDurationMs = Date.now() - fetchStartedAt;
  } catch (error) {
    state.telemetry.lastFetchDurationMs = Date.now() - refreshStartedAt;
    result = createFallbackResult(error);
  }

  const snapshot = await persistDatabaseSnapshot(state, result);
  const completedAt = new Date().toISOString();

  state.telemetry.lastRefreshCompletedAt = completedAt;
  state.telemetry.lastRefreshDurationMs = Date.now() - refreshStartedAt;
  state.telemetry.lastUpstreamStatus = result.upstreamStatus;
  state.telemetry.lastResultMessage = result.message;

  state.telemetry.lastError = state.telemetry.lastPersistError
    ? state.telemetry.lastPersistError
    : result.upstreamStatus &&
        result.upstreamStatus >= 200 &&
        result.upstreamStatus < 300
      ? null
      : result.message;

  state.consecutiveFailureCount = isSuccessfulResult(result)
    ? 0
    : state.consecutiveFailureCount + 1;

  if (
    result.upstreamStatus &&
    result.upstreamStatus >= 200 &&
    result.upstreamStatus < 300
  ) {
    state.telemetry.lastSuccessfulFetchAt = completedAt;
  }

  return snapshot;
}

export function ensureDispatchPolling() {
  const state = getDispatchHubState();

  if (state.intervalId) {
    return;
  }

  void refreshDispatchSnapshot();
}

export async function refreshDispatchSnapshot() {
  const state = getDispatchHubState();

  if (state.inFlight) {
    return state.inFlight;
  }

  state.inFlight = fetchAndPersistSnapshot(state).finally(() => {
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

  return {
    ok: true,
    pollIntervalMs: getPollIntervalMs(),
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
      configured: false,
      subscribed: false,
      clientStatus: "disabled",
      publisherStatus: "disabled",
      subscriberStatus: "disabled",
    },
    telemetry: {
      ...state.telemetry,
      lastPollIntervalMs: state.lastScheduledPollIntervalMs,
      consecutiveFailureCount: state.consecutiveFailureCount,
    },
  };
}