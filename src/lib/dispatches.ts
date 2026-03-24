import {
  getFirstDueApiUrl,
  getFirstDueAuthConfig,
  getFirstDueTimeoutMs,
} from "@/lib/firstdue-env";
import {
  sortDispatchesNewestFirst,
  type DispatchRecord,
} from "@/lib/dispatch-shared";

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

export type DispatchFetchResult = {
  configured: boolean;
  upstreamStatus: number | null;
  dispatches: DispatchRecord[];
  message: string | null;
  rawPreview?: unknown;
  sourceLabel: string | null;
};

type Dictionary = Record<string, unknown>;

const DISPATCH_TIME_ZONE = "America/New_York";
const DEFAULT_LIVE_PAGE_SCAN_LIMIT = 1;
const FIRSTDUE_REQUEST_ATTEMPTS = 2;

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

function getLivePageScanLimit() {
  const rawValue =
    process.env.FIRSTDUE_LIVE_PAGE_SCAN_LIMIT ??
    String(DEFAULT_LIVE_PAGE_SCAN_LIMIT);
  const parsedValue = Number(rawValue);

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? Math.floor(parsedValue)
    : DEFAULT_LIVE_PAGE_SCAN_LIMIT;
}

function getConfig(): PollConfig {
  const auth = getFirstDueAuthConfig();

  return {
    apiUrl: getFirstDueApiUrl(),
    apiMethod: process.env.FIRSTDUE_API_METHOD ?? "GET",
    apiHeaderName: auth.headerName,
    apiHeaderValue: auth.headerValue,
    apiTimeoutMs: getFirstDueTimeoutMs(8000),
  };
}

function validateConfig(config: PollConfig) {
  if (!config.apiUrl) {
    return "Set FIRSTDUE_API_URL in your server environment variables to enable live polling.";
  }

  try {
    new URL(config.apiUrl);
  } catch {
    return "FIRSTDUE_API_URL is set but not a valid URL. Remove wrapping quotes and verify the full https:// endpoint.";
  }

  return null;
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

function parseLastPageFromLinkHeader(linkHeader: string | null) {
  if (!linkHeader) {
    return 1;
  }

  const lastMatch = linkHeader.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/i);

  if (lastMatch) {
    return Number(lastMatch[1]);
  }

  return linkHeader.includes('rel="next"') ? 2 : 1;
}

function buildDispatchPageUrl(baseUrl: string, page: number) {
  const url = new URL(baseUrl);
  url.searchParams.set("page", String(page));
  return url.toString();
}

function parseArrayOfStrings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => stringifyValue(item))
    .filter((item): item is string => item !== null);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const timeZoneName = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;

  const match = timeZoneName?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);

  if (!match) {
    return 0;
  }

  const [, sign, hours, minutes = "00"] = match;
  const offsetMs =
    (Number(hours) * 60 + Number(minutes)) * 60 * 1000;

  return sign === "+" ? offsetMs : -offsetMs;
}

function parseCadDateInEasternTime({
  year,
  month,
  day,
  hours,
  minutes,
  seconds,
}: {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
}) {
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  const offsetMs = getTimeZoneOffsetMs(new Date(wallClockAsUtc), DISPATCH_TIME_ZONE);

  return new Date(wallClockAsUtc - offsetMs);
}

export function parseCadTimestamp(rawValue: string) {
  const match = rawValue.match(
    /\[(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/,
  );

  if (!match) {
    return null;
  }

  const [, month, day, year, hours, minutes, seconds] = match;
  const parsed = parseCadDateInEasternTime({
    year: Number(`20${year}`),
    month: Number(month),
    day: Number(day),
    hours: Number(hours),
    minutes: Number(minutes),
    seconds: Number(seconds),
  });

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

function isOpenDispatchStatus(status: string | null) {
  return status?.trim().toLowerCase() === "open";
}

function dedupeDispatches(dispatches: DispatchRecord[]) {
  const seenIds = new Set<string>();

  return dispatches.filter((dispatch) => {
    if (seenIds.has(dispatch.id)) {
      return false;
    }

    seenIds.add(dispatch.id);
    return true;
  });
}

async function fetchDispatchPage(
  url: string,
  method: string,
  headers: Headers,
  timeoutMs: number,
) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= FIRSTDUE_REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        cache: "no-store",
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();
      const payload = parseUpstreamPayload(body, contentType);

      if (
        attempt < FIRSTDUE_REQUEST_ATTEMPTS &&
        isRetryableFirstDueStatus(response.status)
      ) {
        continue;
      }

      return {
        response,
        payload,
        dispatches: normalizeDispatchPayload(payload),
      };
    } catch (error) {
      lastError = error;

      if (
        attempt >= FIRSTDUE_REQUEST_ATTEMPTS ||
        !isRetryableFirstDueError(error)
      ) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("FirstDue request failed.");
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

function extractUpstreamErrorMessage(payload: unknown) {
  const dictionary = asDictionary(payload);

  if (dictionary) {
    return (
      pickString(dictionary, ["message", "error", "detail", "title"]) ??
      null
    );
  }

  if (typeof payload === "string" && payload.trim()) {
    return payload.trim().slice(0, 200);
  }

  return null;
}

export function isRetryableFirstDueStatus(status: number) {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function isRetryableFirstDueError(error: unknown) {
  return error instanceof TypeError;
}

export function describeFirstDueHttpFailure(status: number, payload?: unknown) {
  const upstreamMessage = extractUpstreamErrorMessage(payload);

  if (status === 401) {
    return "FirstDue rejected the configured credentials (HTTP 401). Check FIRSTDUE_API_HEADER_NAME and FIRSTDUE_API_HEADER_VALUE.";
  }

  if (status === 403) {
    return "FirstDue accepted the request but denied access (HTTP 403). The current credentials do not have permission for this endpoint.";
  }

  if (status === 503 || status === 504) {
    return upstreamMessage
      ? `FirstDue is temporarily unavailable (${status}): ${upstreamMessage}`
      : `FirstDue is temporarily unavailable (HTTP ${status}).`;
  }

  return upstreamMessage ?? `FirstDue returned HTTP ${status}.`;
}

function describeFetchFailure(error: unknown, config: PollConfig) {
  if (
    error instanceof Error &&
    error.name === "AbortError"
  ) {
    return `FirstDue request timed out after ${config.apiTimeoutMs} ms. Check FIRSTDUE_API_URL, auth, and network access.`;
  }

  if (error instanceof TypeError) {
    return "Could not reach the configured FirstDue endpoint. Check FIRSTDUE_API_URL and network access.";
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "FirstDue polling failed.";
}

export async function fetchFirstDueDispatches(): Promise<DispatchFetchResult> {
  const config = getConfig();
  const configIssue = validateConfig(config);

  if (configIssue) {
    return {
      configured: false,
      upstreamStatus: null as number | null,
      dispatches: [] as DispatchRecord[],
      message: configIssue,
      sourceLabel: null,
    };
  }

  const apiUrl = config.apiUrl as string;

  try {
    const headers = new Headers({
      Accept: "application/json",
    });

    if (config.apiHeaderValue) {
      headers.set(config.apiHeaderName, config.apiHeaderValue);
    }

    const firstPageUrl = buildDispatchPageUrl(apiUrl, 1);
    const firstPage = await fetchDispatchPage(
      firstPageUrl,
      config.apiMethod,
      headers,
      config.apiTimeoutMs,
    );
    const allDispatches = [...firstPage.dispatches];
    const firstPageHasOpenDispatch = firstPage.dispatches.some((dispatch) =>
      isOpenDispatchStatus(dispatch.status),
    );
    const lastPage = parseLastPageFromLinkHeader(
      firstPage.response.headers.get("link"),
    );
    const maxPages = firstPageHasOpenDispatch
      ? 1
      : Math.min(lastPage, getLivePageScanLimit());
    let supplementalPageFailure: string | null = null;

    for (let page = 2; page <= maxPages; page += 1) {
      try {
        const currentPage = await fetchDispatchPage(
          buildDispatchPageUrl(apiUrl, page),
          config.apiMethod,
          headers,
          config.apiTimeoutMs,
        );

        if (!currentPage.response.ok) {
          supplementalPageFailure = `Additional dispatch page ${page} returned HTTP ${currentPage.response.status}.`;
          break;
        }

        allDispatches.push(...currentPage.dispatches);

        if (!currentPage.dispatches.some((dispatch) => isOpenDispatchStatus(dispatch.status))) {
          break;
        }
      } catch (error) {
        supplementalPageFailure =
          error instanceof Error
            ? `Additional dispatch page ${page} failed: ${error.message}`
            : `Additional dispatch page ${page} failed.`;
        break;
      }
    }

    const dispatches = sortDispatchesNewestFirst(dedupeDispatches(allDispatches));
    const response = firstPage.response;
    const payload = firstPage.payload;

    return {
      configured: true,
      upstreamStatus: response.status,
      dispatches,
      message:
        response.ok
          ? supplementalPageFailure
          : describeFirstDueHttpFailure(response.status, payload),
      sourceLabel: describeSource(apiUrl),
      rawPreview:
        typeof payload === "string" ? payload.slice(0, 500) : payload,
    };
  } catch (error) {
    return {
      configured: true,
      upstreamStatus: null,
      dispatches: [],
      message: describeFetchFailure(error, config),
      sourceLabel: describeSource(apiUrl),
    };
  }
}
