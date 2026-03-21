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

type UnitMatcher = {
  id: string;
  displayName: string;
  apparatus: string;
  apparatusApiId?: string;
  radioName: string;
  dispatchAliases?: string[];
};

type PollConfig = {
  apiUrl: string | null;
  apiMethod: string;
  apiHeaderName: string;
  apiHeaderValue: string | null;
  apiTimeoutMs: number;
};

type DispatchFetchResult = {
  configured: boolean;
  upstreamStatus: number | null;
  dispatches: DispatchRecord[];
  message: string | null;
  rawPreview?: unknown;
  sourceLabel: string | null;
};

type Dictionary = Record<string, unknown>;

const CANDIDATE_ARRAY_PATHS = [
  ["dispatches"],
  ["incidents"],
  ["data"],
  ["data", "dispatches"],
  ["data", "incidents"],
  ["results"],
  ["items"],
];

const ID_KEYS = ["id", "dispatchId", "incidentId", "callId", "eventId", "uuid"];
const INCIDENT_KEYS = [
  "incidentNumber",
  "incidentNo",
  "incident",
  "callNumber",
  "eventNumber",
  "incident_number",
  "xref_id",
];
const ADDRESS_KEYS = [
  "address",
  "fullAddress",
  "location",
  "sceneAddress",
  "incidentAddress",
  "address_1",
];
const NATURE_KEYS = ["nature", "type", "incidentType", "callType", "description"];
const UNIT_KEYS = [
  "unit",
  "unitName",
  "assignedUnit",
  "apparatus",
  "company",
  "unit_codes",
];
const STATUS_KEYS = ["status", "state", "disposition", "status_code"];
const TIMESTAMP_KEYS = [
  "timestamp",
  "createdAt",
  "dispatchedAt",
  "alarmTime",
  "receivedAt",
  "dateTime",
  "created_at",
];
const ENROUTE_KEYS = [
  "enrouteAt",
  "enRouteAt",
  "enrouteTime",
  "enRouteTime",
  "unitEnrouteAt",
  "respondingAt",
];

const CLOSED_STATUSES = [
  "closed",
  "close",
  "completed",
  "complete",
  "cleared",
  "clear",
  "cancelled",
  "canceled",
  "service complete",
  "out of service",
];

const STALE_OPEN_DISPATCH_MS = 12 * 60 * 60 * 1000;
const RESOLVED_MESSAGE_PATTERNS = [
  /\ball units clear\b/i,
  /\ball fd units clear\b/i,
  /\bscene turned over\b/i,
  /\bturned over to\b/i,
  /\brma\b/i,
  /\bservice complete\b/i,
  /\bincident complete\b/i,
  /\bcommand terminated\b/i,
];

function getConfig(): PollConfig {
  const timeout = Number(process.env.FIRSTDUE_TIMEOUT_MS ?? "8000");

  return {
    apiUrl: process.env.FIRSTDUE_API_URL ?? null,
    apiMethod: process.env.FIRSTDUE_API_METHOD ?? "GET",
    apiHeaderName: process.env.FIRSTDUE_API_HEADER_NAME ?? "Authorization",
    apiHeaderValue:
      process.env.FIRSTDUE_API_HEADER_VALUE ??
      (process.env.FIRSTDUE_API_TOKEN
        ? `Bearer ${process.env.FIRSTDUE_API_TOKEN}`
        : null),
    apiTimeoutMs: Number.isFinite(timeout) ? timeout : 8000,
  };
}

function describeSource(apiUrl: string) {
  try {
    const url = new URL(apiUrl);
    const isLocal =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1";

    if (isLocal && url.pathname.includes("/api/mock-dispatches")) {
      return "Mock feed";
    }

    if (isLocal) {
      return "Local feed";
    }

    return `Live feed: ${url.hostname}`;
  } catch {
    return "Configured feed";
  }
}

function asDictionary(value: unknown): Dictionary | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Dictionary)
    : null;
}

function getNestedValue(value: unknown, path: string[]): unknown {
  let current: unknown = value;

  for (const key of path) {
    const dictionary = asDictionary(current);

    if (!dictionary || !(key in dictionary)) {
      return undefined;
    }

    current = dictionary[key];
  }

  return current;
}

function stringifyValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const parts = value
      .map(stringifyValue)
      .filter((part): part is string => part !== null);

    return parts.length > 0 ? parts.join(", ") : null;
  }

  return null;
}

function pickString(record: Dictionary, keys: string[]): string | null {
  for (const key of keys) {
    const stringValue = stringifyValue(record[key]);

    if (stringValue) {
      return stringValue;
    }
  }

  return null;
}

function inferArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  for (const path of CANDIDATE_ARRAY_PATHS) {
    const value = getNestedValue(payload, path);

    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function parseArrayOfStrings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => stringifyValue(item))
    .filter((item): item is string => item !== null);
}

export function parseCadTimestamp(rawValue: string) {
  const match = rawValue.match(
    /\[(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/,
  );

  if (!match) {
    return null;
  }

  const [, month, day, year, hours, minutes, seconds] = match;
  const fullYear = `20${year}`;
  const isoValue = `${fullYear}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  const parsed = new Date(isoValue);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveDutyDispatchTimestampFromCadMessage({
  incidentNumber,
  unitCodes,
  message,
}: {
  incidentNumber: string | null;
  unitCodes: string[];
  message: string | null;
}) {
  if (!incidentNumber?.toUpperCase().startsWith("E")) {
    return null;
  }

  const normalizedUnitCodes = unitCodes.map((code) => code.trim().toUpperCase());

  if (!normalizedUnitCodes.includes("F22DUTY")) {
    return null;
  }

  if (!message) {
    return null;
  }

  const lines = message.split("\n");
  const timestampPattern = /\[\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}/;

  function timestampAtOrBefore(index: number) {
    for (let currentIndex = index; currentIndex >= 0; currentIndex -= 1) {
      if (timestampPattern.test(lines[currentIndex] ?? "")) {
        return lines[currentIndex] ?? null;
      }
    }

    return null;
  }

  const interrogationIndex = lines.findIndex((line) =>
    /Interrogation is complete/i.test(line),
  );

  if (interrogationIndex >= 0) {
    return parseCadTimestamp(timestampAtOrBefore(interrogationIndex) ?? "")?.toISOString() ?? null;
  }

  const dispatchCodeIndex = lines.findIndex((line) => /Dispatch Code:/i.test(line));

  if (dispatchCodeIndex >= 0) {
    return parseCadTimestamp(timestampAtOrBefore(dispatchCodeIndex) ?? "")?.toISOString() ?? null;
  }

  const firstTimestampedLine = lines.find((line) => timestampPattern.test(line)) ?? null;

  return parseCadTimestamp(firstTimestampedLine ?? "")?.toISOString() ?? null;
}

function resolveEmsDutyDispatchTime(record: Dictionary, incidentNumber: string | null) {
  return resolveDutyDispatchTimestampFromCadMessage({
    incidentNumber,
    unitCodes: parseArrayOfStrings(record.unit_codes),
    message: stringifyValue(record.message),
  });
}

function extractLatestCadActivityTimestamp(message: string | null) {
  if (!message) {
    return null;
  }

  const matches = message.matchAll(/\[(\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})[^\]]*\]/g);
  let latestTimestamp: number | null = null;

  for (const match of matches) {
    const parsed = parseCadTimestamp(`[${match[1]}]`);

    if (!parsed) {
      continue;
    }

    const timestamp = parsed.getTime();

    if (latestTimestamp === null || timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
    }
  }

  return latestTimestamp === null ? null : new Date(latestTimestamp).toISOString();
}

function normalizeRecord(item: unknown, index: number): DispatchRecord | null {
  const record = asDictionary(item);

  if (!record) {
    return null;
  }

  const id =
    pickString(record, ID_KEYS) ??
    pickString(record, INCIDENT_KEYS) ??
    `dispatch-${index}`;
  const incidentNumber = pickString(record, INCIDENT_KEYS);

  return {
    id,
    incidentNumber,
    address: pickString(record, ADDRESS_KEYS),
    nature: pickString(record, NATURE_KEYS),
    unit: pickString(record, UNIT_KEYS),
    status: pickString(record, STATUS_KEYS),
    dispatchedAt:
      resolveEmsDutyDispatchTime(record, incidentNumber) ??
      pickString(record, TIMESTAMP_KEYS),
    lastActivityAt:
      pickString(record, ["updatedAt", "updated_at", "lastUpdatedAt"]) ??
      extractLatestCadActivityTimestamp(stringifyValue(record.message)) ??
      resolveEmsDutyDispatchTime(record, incidentNumber) ??
      pickString(record, TIMESTAMP_KEYS),
    message: stringifyValue(record.message),
    enrouteAt: pickString(record, ENROUTE_KEYS),
    raw: item,
  };
}

export function normalizeDispatchPayload(payload: unknown): DispatchRecord[] {
  return inferArray(payload)
    .map(normalizeRecord)
    .filter((record): record is DispatchRecord => record !== null);
}

export function isClosedDispatchStatus(status: string | null) {
  if (!status) {
    return false;
  }

  return CLOSED_STATUSES.includes(status.trim().toLowerCase());
}

export function isResolvedDispatch(
  dispatch: Pick<DispatchRecord, "status" | "message">,
) {
  if (isClosedDispatchStatus(dispatch.status)) {
    return true;
  }

  if (!dispatch.message) {
    return false;
  }

  const message = dispatch.message;
  return RESOLVED_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

export function isStaleOpenDispatch(
  dispatch: Pick<DispatchRecord, "status" | "dispatchedAt" | "lastActivityAt" | "message">,
  now = Date.now(),
) {
  if (isResolvedDispatch(dispatch)) {
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
      parseDispatchTimestamp(right.dispatchedAt) - parseDispatchTimestamp(left.dispatchedAt);

    if (timestampDelta !== 0) {
      return timestampDelta;
    }

    return right.id.localeCompare(left.id);
  });
}

function normalizeUnitToken(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dispatchUnitTokens(unitValue: string | null) {
  if (!unitValue) {
    return new Set<string>();
  }

  return new Set(
    unitValue
      .split(",")
      .map((part) => normalizeUnitToken(part))
      .filter(Boolean),
  );
}

function matchesCandidateToken(dispatchToken: string, candidateToken: string) {
  if (dispatchToken === candidateToken) {
    return true;
  }

  // Some live feeds prefix radio aliases with an agency code, e.g. F22E2.
  // Allow those tokens to match the unit's short alias without relying on a
  // work-order apparatus record ID being reusable as a dispatch unit code.
  return (
    candidateToken.length >= 2 &&
    candidateToken.length <= 4 &&
    dispatchToken.length > candidateToken.length &&
    dispatchToken.endsWith(candidateToken)
  );
}

export function filterDispatchesForUnit(
  dispatches: DispatchRecord[],
  unit: UnitMatcher | null,
) {
  if (!unit) {
    return dispatches;
  }

  const candidateTokens = new Set(
    [
      unit.id,
      unit.displayName,
      unit.apparatus,
      unit.apparatusApiId,
      unit.radioName,
      `${unit.apparatus} ${unit.id}`,
      `${unit.apparatus} ${unit.radioName}`,
      `${unit.apparatus}${unit.radioName}`,
      ...(unit.dispatchAliases ?? []),
    ]
      .filter((value): value is string => typeof value === "string")
      .map(normalizeUnitToken)
      .filter(Boolean),
  );

  return dispatches.filter((dispatch) => {
    const tokens = dispatchUnitTokens(dispatch.unit);

    if (tokens.size === 0) {
      return false;
    }

    for (const token of candidateTokens) {
      for (const dispatchToken of tokens) {
        if (matchesCandidateToken(dispatchToken, token)) {
          return true;
        }
      }
    }

    return false;
  });
}

function parseUpstreamPayload(body: string, contentType: string) {
  if (contentType.includes("application/json")) {
    return JSON.parse(body) as unknown;
  }

  const trimmed = body.trim();

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return body;
    }
  }

  return body;
}

export async function fetchFirstDueDispatches(): Promise<DispatchFetchResult> {
  const config = getConfig();

  if (!config.apiUrl) {
    return {
      configured: false,
      upstreamStatus: null as number | null,
      dispatches: [] as DispatchRecord[],
      message:
        "Set FIRSTDUE_API_URL and auth environment variables to enable live polling.",
      sourceLabel: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.apiTimeoutMs);

  try {
    const headers = new Headers({
      Accept: "application/json",
    });

    if (config.apiHeaderValue) {
      headers.set(config.apiHeaderName, config.apiHeaderValue);
    }

    const response = await fetch(config.apiUrl, {
      method: config.apiMethod,
      headers,
      cache: "no-store",
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    const payload = parseUpstreamPayload(body, contentType);

    const dispatches = sortDispatchesNewestFirst(normalizeDispatchPayload(payload));

    return {
      configured: true,
      upstreamStatus: response.status,
      dispatches,
      message: response.ok ? null : "FirstDue returned a non-success response.",
      sourceLabel: describeSource(config.apiUrl),
      rawPreview:
        typeof payload === "string" ? payload.slice(0, 500) : payload,
    };
  } finally {
    clearTimeout(timeout);
  }
}
