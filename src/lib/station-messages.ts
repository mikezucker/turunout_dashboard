import { loadEnvConfig } from "@next/env";
import { normalizeEnvValue } from "@/lib/firstdue-env";
import { getUnitProfile } from "@/lib/unit-session";

export type StationDashboardMessage = {
  id: string;
  title: string;
  body: string | null;
  type: string;
  priority: "NORMAL" | "HIGH" | "CRITICAL" | string;
  audience: string | null;
  stationNumberTarget: number | null;
  stationLabel: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  dashboardDisplay?: {
    summary: string;
    canClose: boolean;
    shouldReturnAfterClose: boolean;
    policyActionOnly: boolean;
  };
};

type StationMessagesUpstreamResponse = {
  success?: boolean;
  error?: string;
  stationNumber?: number;
  messages?: StationDashboardMessage[];
};

type StationMessagesFetchResult = {
  ok: boolean;
  message: string | null;
  stationNumber: number | null;
  messages: StationDashboardMessage[];
};

const DEFAULT_MTFD_SITE_BASE_URL = "https://new-mtfd-site.vercel.app";

let envLoaded = false;

function ensureServerEnvLoaded() {
  if (envLoaded) return;
  loadEnvConfig(process.cwd());
  envLoaded = true;
}

function getMtfdSiteBaseUrl() {
  ensureServerEnvLoaded();
  return (
    normalizeEnvValue(process.env.MTFD_SITE_BASE_URL) ??
    DEFAULT_MTFD_SITE_BASE_URL
  ).replace(/\/+$/, "");
}

function getStationMessagesApiUrl() {
  ensureServerEnvLoaded();
  return (
    normalizeEnvValue(process.env.STATION_DASHBOARD_MESSAGES_API_URL) ??
    `${getMtfdSiteBaseUrl()}/api/station-dashboard/messages`
  );
}

function getDashboardApiToken() {
  ensureServerEnvLoaded();
  return normalizeEnvValue(process.env.DASHBOARD_API_TOKEN);
}

function getStationMessagesTimeoutMs() {
  ensureServerEnvLoaded();
  const parsed = Number(
    normalizeEnvValue(process.env.STATION_MESSAGES_TIMEOUT_MS) ?? "8000",
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8000;
}

function stationNumberFromStationLabel(station: string | null | undefined) {
  const match = station?.match(/\bstation\s*([1-5])\b/i);
  return match ? Number(match[1]) : null;
}

export async function fetchStationMessagesForUnit(
  unitId: string,
): Promise<StationMessagesFetchResult> {
  const unit = getUnitProfile(unitId);

  if (!unit) {
    return {
      ok: false,
      message: "Unit profile not found.",
      stationNumber: null,
      messages: [],
    };
  }

  const stationNumber = stationNumberFromStationLabel(unit.station);

  if (!stationNumber) {
    return {
      ok: false,
      message: "Unit station number is not configured.",
      stationNumber: null,
      messages: [],
    };
  }

  const apiUrl = getStationMessagesApiUrl();
  const apiToken = getDashboardApiToken();

  if (!apiUrl || !apiToken) {
    return {
      ok: false,
      message: "Station messages feed is not configured.",
      stationNumber,
      messages: [],
    };
  }

  let requestUrl: URL;

  try {
    requestUrl = new URL(apiUrl);
  } catch {
    return {
      ok: false,
      message: "Station messages API URL is invalid.",
      stationNumber,
      messages: [],
    };
  }

  requestUrl.searchParams.set("stationNumber", String(stationNumber));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getStationMessagesTimeoutMs());

  try {
    const response = await fetch(requestUrl.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => null)) as
      | StationMessagesUpstreamResponse
      | null;

    if (!response.ok || payload?.success === false) {
      return {
        ok: false,
        message:
          payload?.error ?? `Station messages request failed (${response.status}).`,
        stationNumber,
        messages: [],
      };
    }

    return {
      ok: true,
      message: null,
      stationNumber: payload?.stationNumber ?? stationNumber,
      messages: Array.isArray(payload?.messages) ? payload.messages : [],
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Station messages request failed.",
      stationNumber,
      messages: [],
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
