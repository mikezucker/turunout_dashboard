export type DispatchRecord = {
  id: string;
  incidentNumber: string | null;
  address: string | null;
  nature: string | null;
  unit: string | null;
  status: string | null;
  dispatchedAt: string | null;
  lastActivityAt: string | null;
  message: string | null;
  enrouteAt: string | null;
  raw: unknown;
};

const CLOSED_STATUS_PATTERNS = [
  /\bclosed?\b/i,
  /\bcompleted?\b/i,
  /\bcleared?\b/i,
  /\bcancelled?\b/i,
  /\bservice complete\b/i,
  /\bincident complete\b/i,
  /\bavailable\b/i,
  /\bback in service\b/i,
  /\breturn(?:ed)? to service\b/i,
  /\bout of service\b/i,
];

const STALE_OPEN_DISPATCH_MS = 12 * 60 * 60 * 1000;
const SHORT_LIVED_OPEN_RESOLVE_MS = 4 * 60 * 60 * 1000;
const RESOLVED_MESSAGE_PATTERNS = [
  /\ball units clear\b/i,
  /\ball fd units clear\b/i,
  /\bscene turned over\b/i,
  /\bturned over to\b/i,
  /\brma\b/i,
  /\bservice complete\b/i,
  /\bincident complete\b/i,
  /\bcommand terminated\b/i,
  /\bavailable\b/i,
  /\bback in service\b/i,
  /\breturn(?:ed)? to service\b/i,
];
const SHORT_LIVED_CALL_TYPES = new Set([
  "ASSIST POLICE",
  "PUBLIC SERVICE",
  "STANDBY",
  "ELEVATOR EMERGENCY [56]",
  "LOCK OUT   TAG OUT ELEVATOR FD NOTIFICATION ONLY",
]);

export function isClosedDispatchStatus(status: string | null) {
  if (!status) {
    return false;
  }

  return CLOSED_STATUS_PATTERNS.some((pattern) => pattern.test(status));
}

export function isResolvedDispatch(
  dispatch: Pick<
    DispatchRecord,
    "status" | "message" | "nature" | "dispatchedAt" | "lastActivityAt"
  >,
  now = Date.now(),
) {
  if (isClosedDispatchStatus(dispatch.status)) {
    return true;
  }

  if (!dispatch.message) {
    return false;
  }

  const message = dispatch.message;
  if (RESOLVED_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return true;
  }

  if (dispatch.status?.trim().toLowerCase() !== "open") {
    return false;
  }

  const normalizedNature = dispatch.nature?.trim().toUpperCase() ?? "";
  if (!SHORT_LIVED_CALL_TYPES.has(normalizedNature)) {
    return false;
  }

  const latestActivityAt = dispatch.lastActivityAt ?? dispatch.dispatchedAt;
  if (!latestActivityAt) {
    return false;
  }

  const latestActivityTimestamp = Date.parse(latestActivityAt);
  if (!Number.isFinite(latestActivityTimestamp)) {
    return false;
  }

  return now - latestActivityTimestamp >= SHORT_LIVED_OPEN_RESOLVE_MS;
}

export function isStaleOpenDispatch(
  dispatch: Pick<
    DispatchRecord,
    "status" | "dispatchedAt" | "lastActivityAt" | "message" | "nature"
  >,
  now = Date.now(),
) {
  if (isResolvedDispatch(dispatch, now)) {
    return false;
  }

  if (dispatch.status?.trim().toLowerCase() !== "open") {
    return false;
  }

  const latestActivityAt = dispatch.lastActivityAt ?? dispatch.dispatchedAt;

  if (!latestActivityAt) {
    return false;
  }

  const latestActivityTimestamp = Date.parse(latestActivityAt);

  if (!Number.isFinite(latestActivityTimestamp)) {
    return false;
  }

  return now - latestActivityTimestamp >= STALE_OPEN_DISPATCH_MS;
}

function parseDispatchTimestamp(value: string | null) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function sortDispatchesNewestFirst(dispatches: DispatchRecord[]) {
  return [...dispatches].sort((left, right) => {
    const timestampDelta =
      parseDispatchTimestamp(right.dispatchedAt) -
      parseDispatchTimestamp(left.dispatchedAt);

    if (timestampDelta !== 0) {
      return timestampDelta;
    }

    return right.id.localeCompare(left.id);
  });
}
