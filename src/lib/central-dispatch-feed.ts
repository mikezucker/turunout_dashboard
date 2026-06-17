import { type DispatchFetchResult } from "@/lib/dispatches";
import { filterRespondingUnits } from "@/lib/dispatch-unit-rules";
import { type DispatchSnapshot } from "@/lib/dispatch-feed";
import {
  sortDispatchesNewestFirst,
  type DispatchRecord,
} from "@/lib/dispatch-shared";

type CentralDispatch = {
  id?: unknown;
  stableId?: unknown;
  callType?: unknown;
  message?: unknown;
  address?: unknown;
  units?: unknown;
  status?: unknown;
  dispatchedAt?: unknown;
  lastActivityAt?: unknown;
};

type CentralDispatchResponse = {
  success?: unknown;
  configured?: unknown;
  upstreamStatus?: unknown;
  fetchedAt?: unknown;
  sourceLabel?: unknown;
  message?: unknown;
  dispatches?: unknown;
  activeDispatches?: unknown;
};

const DEFAULT_MTFD_SITE_BASE_URL = "https://new-mtfd-site.vercel.app";
const CENTRAL_DISPATCH_TIMEOUT_MS = 10000;

function getMtfdSiteBaseUrl() {
  return (
    process.env.MTFD_SITE_BASE_URL?.trim() ||
    DEFAULT_MTFD_SITE_BASE_URL
  ).replace(/\/+$/, "");
}

function getCentralDispatchUrl() {
  return `${getMtfdSiteBaseUrl()}/api/shared/active-dispatches`;
}

function asString(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function asStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map(asString)
      .filter((item): item is string => item !== null);
  }

  const stringValue = asString(value);
  return stringValue
    ? stringValue.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function asStatus(value: unknown, fallback: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function asDictionary(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractCentralDispatches(payload: CentralDispatchResponse) {
  const dispatches = Array.isArray(payload.activeDispatches)
    ? payload.activeDispatches
    : payload.dispatches;

  return Array.isArray(dispatches) ? dispatches : [];
}

function normalizeCentralDispatch(
  item: unknown,
  index: number,
): DispatchRecord | null {
  const record = asDictionary(item) as CentralDispatch | null;

  if (!record) {
    return null;
  }

  const units = filterRespondingUnits(asStringArray(record.units));
  const id =
    asString(record.id) ??
    asString(record.stableId) ??
    `central-dispatch-${index}`;
  const incidentNumber = asString(record.stableId) ?? id;

  return {
    id,
    incidentNumber,
    address: asString(record.address),
    nature: asString(record.callType),
    unit: units.length > 0 ? units.join(", ") : null,
    status: asString(record.status) ?? "Open",
    dispatchedAt: asString(record.dispatchedAt),
    lastActivityAt: asString(record.lastActivityAt),
    message: asString(record.message),
    enrouteAt: null,
    raw: {
      ...(record as Record<string, unknown>),
      unit_codes: units,
    },
  };
}

async function parseCentralResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();

  if (contentType.includes("application/json") || body.trim().startsWith("{")) {
    return JSON.parse(body) as CentralDispatchResponse;
  }

  throw new Error("Central dispatch endpoint did not return JSON.");
}

function buildFailureResult(message: string, status: number | null): DispatchFetchResult {
  return {
    configured: true,
    upstreamStatus: status,
    dispatches: [],
    message,
    sourceLabel: "MTFD Site dispatch feed",
  };
}

export async function fetchCentralDispatches(): Promise<DispatchFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    CENTRAL_DISPATCH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(getCentralDispatchUrl(), {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await parseCentralResponse(response);
    const centralDispatches = extractCentralDispatches(payload);
    const dispatches = sortDispatchesNewestFirst(
      centralDispatches
        .map(normalizeCentralDispatch)
        .filter((dispatch): dispatch is DispatchRecord => dispatch !== null),
    );
    const sourceLabel = asString(payload.sourceLabel);
    const message = asString(payload.message);
    const upstreamStatus = asStatus(payload.upstreamStatus, response.status);

    return {
      configured: asBoolean(payload.configured, response.ok),
      upstreamStatus,
      dispatches,
      message: response.ok
        ? message
        : message ?? `MTFD Site dispatch feed returned HTTP ${response.status}.`,
      sourceLabel: sourceLabel ? `MTFD Site: ${sourceLabel}` : "MTFD Site",
      rawPreview: payload,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `MTFD Site dispatch feed timed out after ${CENTRAL_DISPATCH_TIMEOUT_MS} ms.`
        : error instanceof Error
          ? error.message
          : "MTFD Site dispatch feed failed.";

    return buildFailureResult(message, null);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCentralDispatchSnapshot(): Promise<DispatchSnapshot> {
  return {
    fetchedAt: new Date().toISOString(),
    revision: Date.now(),
    result: await fetchCentralDispatches(),
  };
}
