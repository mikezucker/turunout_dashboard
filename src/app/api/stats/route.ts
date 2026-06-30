import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getUnitProfile,
  readSessionToken,
  sessionCookieName,
} from "@/lib/unit-session";
import { normalizeEnvValue } from "@/lib/firstdue-env";

export const dynamic = "force-dynamic";

type DispatchBucket = {
  total24h: number;
  total7d: number;
  total30d: number;
  totalYtd: number;
  fire24h: number;
  fire7d: number;
  fire30d: number;
  fireYtd: number;
  ems24h: number;
  ems7d: number;
  ems30d: number;
  emsYtd: number;
};

type SharedDispatchStatsResponse = {
  ok?: boolean;
  message?: string | null;
  sourceLabel?: string | null;
  stats?: {
    departmentYtd?: number;
    stationYtd?: number;
  };
  department?: DispatchBucket;
  station?: DispatchBucket;
  lastUpdated?: string;
  error?: string;
};

type TurnoutStatsResponse = {
  ok: boolean;
  message: string | null;
  sourceLabel: string | null;
  year: number;
  liveTotalsAvailable: boolean;
  totalDepartmentCalls: number;
  totalApparatusCalls: number;
  totalScopedCalls: number;
  emsCalls: number;
  fireRescueCalls: number;
  rollingWindows: Array<{
    label: string;
    days: number;
    totalDepartmentCalls: number;
    totalApparatusCalls: number;
    totalScopedCalls: number;
    emsCalls: number;
    fireRescueCalls: number;
    sourceLabel: string | null;
  }>;
  lastUpdated?: string | null;
};

const MTFD_SITE_BASE_URL =
  process.env.MTFD_SITE_BASE_URL ?? "https://new-mtfd-site.vercel.app";
const LAST_GOOD_STATS_TTL_MS = 30 * 60 * 1000;
const SHARED_STATS_TIMEOUT_MS = 45_000;
const lastGoodStatsByUnit = new Map<
  string,
  {
    value: TurnoutStatsResponse;
    updatedAt: number;
  }
>();

function dashboardApiTokens() {
  return [
    normalizeEnvValue(process.env.DISPATCH_MOBILE_API_TOKEN),
    normalizeEnvValue(process.env.DASHBOARD_API_TOKEN),
  ].filter((token, index, tokens): token is string => {
    return Boolean(token) && tokens.indexOf(token) === index;
  });
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stationNumberFromLabel(station: string | null | undefined) {
  const match = station?.match(/\bstation\s*([1-5])\b/i);
  return match ? match[1] : null;
}

function emptyStatsPayload(message: string): TurnoutStatsResponse {
  return {
    ok: false,
    message,
    sourceLabel: "MTFD Site dispatch stats",
    year: new Date().getFullYear(),
    liveTotalsAvailable: false,
    totalDepartmentCalls: 0,
    totalApparatusCalls: 0,
    totalScopedCalls: 0,
    emsCalls: 0,
    fireRescueCalls: 0,
    rollingWindows: [
      emptyWindow("Last 24 Hours", 1),
      emptyWindow("Last 7 Days", 7),
      emptyWindow("Last 30 Days", 30),
    ],
  };
}

function emptyWindow(label: string, days: number) {
  return {
    label,
    days,
    totalDepartmentCalls: 0,
    totalApparatusCalls: 0,
    totalScopedCalls: 0,
    emsCalls: 0,
    fireRescueCalls: 0,
    sourceLabel: "MTFD Site dispatch stats",
  };
}

function joinMessages(...parts: Array<string | null | undefined>) {
  const messages = parts.filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );

  return messages.length > 0 ? messages.join(" ") : null;
}

function rollingWindow(
  label: string,
  days: number,
  department: DispatchBucket | undefined,
  station: DispatchBucket | undefined,
) {
  const key =
    days === 1
      ? "24h"
      : days === 7
        ? "7d"
        : "30d";

  const totalDepartmentCalls = numberOrZero(
    department?.[`total${key}` as keyof DispatchBucket],
  );
  const totalScopedCalls = numberOrZero(
    station?.[`total${key}` as keyof DispatchBucket],
  );

  return {
    label,
    days,
    totalDepartmentCalls,
    totalApparatusCalls: totalScopedCalls,
    totalScopedCalls,
    emsCalls: numberOrZero(station?.[`ems${key}` as keyof DispatchBucket]),
    fireRescueCalls: numberOrZero(
      station?.[`fire${key}` as keyof DispatchBucket],
    ),
    sourceLabel: "MTFD Site dispatch stats",
  };
}

function sharedStatsPayload(payload: SharedDispatchStatsResponse): TurnoutStatsResponse {
  const department = payload.department;
  const station = payload.station;
  const year = new Date().getFullYear();
  const totalDepartmentCalls = numberOrZero(
    department?.totalYtd ?? payload.stats?.departmentYtd,
  );
  const totalScopedCalls = numberOrZero(
    station?.totalYtd ?? payload.stats?.stationYtd,
  );

  return {
    ok: payload.ok === true,
    message: payload.message ?? null,
    sourceLabel: payload.sourceLabel ?? "MTFD Site dispatch stats",
    year,
    liveTotalsAvailable: payload.ok === true,
    totalDepartmentCalls,
    totalApparatusCalls: totalScopedCalls,
    totalScopedCalls,
    emsCalls: numberOrZero(station?.emsYtd),
    fireRescueCalls: numberOrZero(station?.fireYtd),
    rollingWindows: [
      rollingWindow("Last 24 Hours", 1, department, station),
      rollingWindow("Last 7 Days", 7, department, station),
      rollingWindow("Last 30 Days", 30, department, station),
    ],
    lastUpdated: payload.lastUpdated ?? null,
  };
}

function hasUsableTotals(stats: TurnoutStatsResponse) {
  return (
    stats.totalDepartmentCalls > 0 ||
    stats.totalApparatusCalls > 0 ||
    stats.emsCalls > 0 ||
    stats.fireRescueCalls > 0 ||
    stats.rollingWindows.some(
      (window) =>
        window.totalDepartmentCalls > 0 ||
        window.totalApparatusCalls > 0 ||
        window.totalScopedCalls > 0 ||
        window.emsCalls > 0 ||
        window.fireRescueCalls > 0,
    )
  );
}

function rememberStats(unitId: string, stats: TurnoutStatsResponse) {
  if (!hasUsableTotals(stats)) return;
  lastGoodStatsByUnit.set(unitId, {
    value: stats,
    updatedAt: Date.now(),
  });
}

function cachedStats(unitId: string, reason: string) {
  const cached = lastGoodStatsByUnit.get(unitId);
  if (!cached || Date.now() - cached.updatedAt > LAST_GOOD_STATS_TTL_MS) {
    return null;
  }

  return {
    ...cached.value,
    ok: false,
    liveTotalsAvailable: false,
    message: joinMessages(reason, "Showing last known call totals."),
    sourceLabel: cached.value.sourceLabel ?? "Last known call totals",
  };
}

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  const unitId = readSessionToken(token);

  if (!unitId) {
    return NextResponse.json(
      { ok: false, message: "Not authenticated." },
      { status: 401 },
    );
  }

  const unit = getUnitProfile(unitId);

  if (!unit) {
    return NextResponse.json(
      { ok: false, message: "Unit not found." },
      { status: 404 },
    );
  }

  const apiTokens = dashboardApiTokens();

  const requestUrl = new URL("/api/shared/dispatch-stats", MTFD_SITE_BASE_URL);
  const stationNumber = stationNumberFromLabel(unit.station);

  if (stationNumber) {
    requestUrl.searchParams.set("stationNumber", stationNumber);
  } else {
    requestUrl.searchParams.set("station", unit.station);
  }

  if (apiTokens.length === 0) {
    const message = "Shared stats token is not configured.";
    return NextResponse.json(
      cachedStats(unitId, message) ?? emptyStatsPayload(message),
    );
  }

  try {
    let lastFailureReason: string | null = null;

    for (const apiToken of apiTokens) {
      const response = await fetch(requestUrl, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
        signal: AbortSignal.timeout(SHARED_STATS_TIMEOUT_MS),
      });
      const payload = (await response.json().catch(() => null)) as
        | SharedDispatchStatsResponse
        | null;

      if (response.ok && payload) {
        const stats = sharedStatsPayload(payload);
        rememberStats(unitId, stats);
        return NextResponse.json(stats);
      }

      lastFailureReason =
        payload?.error ??
          payload?.message ??
          `MTFD Site dispatch stats returned HTTP ${response.status}.`;

      if (response.status !== 401 && response.status !== 403) {
        break;
      }
    }

    const reason = lastFailureReason ?? "Failed to load shared dispatch stats.";
    return NextResponse.json(
      cachedStats(unitId, reason) ?? emptyStatsPayload(reason),
    );
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Failed to load shared dispatch stats.";
    return NextResponse.json(
      cachedStats(unitId, reason) ?? emptyStatsPayload(reason),
    );
  }
}
