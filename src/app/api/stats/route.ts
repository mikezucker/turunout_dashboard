import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getUnitProfile,
  readSessionToken,
  sessionCookieName,
} from "@/lib/unit-session";

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

const MTFD_SITE_BASE_URL =
  process.env.MTFD_SITE_BASE_URL ?? "https://new-mtfd-site.vercel.app";

function dashboardApiToken() {
  return (
    process.env.DASHBOARD_API_TOKEN?.trim() ||
    process.env.DISPATCH_MOBILE_API_TOKEN?.trim() ||
    null
  );
}

function emptyStatsResponse(message: string, status = 200) {
  const year = new Date().getFullYear();

  return NextResponse.json(
    {
      ok: false,
      message,
      sourceLabel: "MTFD Site dispatch stats",
      year,
      liveTotalsAvailable: true,
      statsDegraded: true,
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
    },
    { status },
  );
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

  const totalDepartmentCalls = department?.[`total${key}` as keyof DispatchBucket] ?? 0;
  const totalScopedCalls = station?.[`total${key}` as keyof DispatchBucket] ?? 0;

  return {
    label,
    days,
    totalDepartmentCalls,
    totalApparatusCalls: totalScopedCalls,
    totalScopedCalls,
    emsCalls: station?.[`ems${key}` as keyof DispatchBucket] ?? 0,
    fireRescueCalls: station?.[`fire${key}` as keyof DispatchBucket] ?? 0,
    sourceLabel: "MTFD Site dispatch stats",
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

  const apiToken = dashboardApiToken();

  if (!apiToken) {
    return emptyStatsResponse("Dashboard stats feed is not configured.", 503);
  }

  const requestUrl = new URL("/api/shared/dispatch-stats", MTFD_SITE_BASE_URL);
  requestUrl.searchParams.set("station", unit.station);
  const stationNumber = unit.station.match(/\b([1-5])\b/)?.[1] ?? null;
  if (stationNumber) {
    requestUrl.searchParams.set("stationNumber", stationNumber);
  }

  try {
    const response = await fetch(requestUrl, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json().catch(() => null)) as
      | SharedDispatchStatsResponse
      | null;

    if (!response.ok || !payload) {
      return emptyStatsResponse(
        payload?.error ??
          payload?.message ??
          `MTFD Site dispatch stats returned HTTP ${response.status}.`,
        200,
      );
    }

    const department = payload.department;
    const station = payload.station;
    const year = new Date().getFullYear();
    const totalDepartmentCalls =
      department?.totalYtd ?? payload.stats?.departmentYtd ?? 0;
    const totalScopedCalls = station?.totalYtd ?? payload.stats?.stationYtd ?? 0;

    return NextResponse.json({
      ok: payload.ok === true,
      message: payload.message ?? null,
      sourceLabel: payload.sourceLabel ?? "MTFD Site dispatch stats",
      year,
      liveTotalsAvailable:
        payload.ok === true ||
        totalDepartmentCalls > 0 ||
        totalScopedCalls > 0 ||
        (station?.fireYtd ?? 0) > 0 ||
        (station?.emsYtd ?? 0) > 0,
      statsDegraded: payload.ok !== true,
      totalDepartmentCalls,
      totalApparatusCalls: totalScopedCalls,
      totalScopedCalls,
      emsCalls: station?.emsYtd ?? 0,
      fireRescueCalls: station?.fireYtd ?? 0,
      rollingWindows: [
        rollingWindow("Last 24 Hours", 1, department, station),
        rollingWindow("Last 7 Days", 7, department, station),
        rollingWindow("Last 30 Days", 30, department, station),
      ],
      lastUpdated: payload.lastUpdated ?? null,
    });
  } catch (error) {
    return emptyStatsResponse(
      error instanceof Error ? error.message : "Failed to load dispatch stats.",
      200,
    );
  }
}
