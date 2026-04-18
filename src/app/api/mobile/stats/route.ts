import { NextRequest, NextResponse } from "next/server";
import { fetchDispatchStats } from "@/lib/stats";
import { getUnitProfile } from "@/lib/unit-session";

export const dynamic = "force-dynamic";

function getAuthorizedUnitId(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const expectedToken = process.env.DISPATCH_MOBILE_API_TOKEN ?? "";
  const configuredUnitId = process.env.DISPATCH_MOBILE_UNIT_ID ?? "";

  if (!expectedToken || !configuredUnitId) {
    return {
      ok: false as const,
      status: 500,
      message:
        "Dispatch mobile auth is not configured. Set DISPATCH_MOBILE_API_TOKEN and DISPATCH_MOBILE_UNIT_ID.",
      unitId: null,
    };
  }

  if (!authHeader.startsWith("Bearer ")) {
    return {
      ok: false as const,
      status: 401,
      message: "Missing bearer token.",
      unitId: null,
    };
  }

  const providedToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (providedToken != expectedToken) {
    return {
      ok: false as const,
      status: 401,
      message: "Invalid bearer token.",
      unitId: null,
    };
  }

  return {
    ok: true as const,
    status: 200,
    message: null,
    unitId: configuredUnitId,
  };
}

export async function GET(request: NextRequest) {
  const auth = getAuthorizedUnitId(request);

  if (!auth.ok || !auth.unitId) {
    return NextResponse.json(
      {
        ok: false,
        message: auth.message,
      },
      { status: auth.status },
    );
  }

  const unit = getUnitProfile(auth.unitId);

  if (!unit) {
    return NextResponse.json(
      {
        ok: false,
        message: "Configured dispatch mobile unit was not found.",
      },
      { status: 404 },
    );
  }

  const result = await fetchDispatchStats(unit);

  return NextResponse.json(
    {
      ok: result.ok,
      message: result.message,
      sourceLabel: result.sourceLabel,
      year: result.year,
      liveTotalsAvailable: result.liveTotalsAvailable,
      stationCallTotal: result.totalApparatusCalls,
      departmentCallTotal: result.totalDepartmentCalls,
      emsCalls: result.emsCalls,
      fireRescueCalls: result.fireRescueCalls,
      rollingWindows: result.rollingWindows,
    },
    { status: 200 },
  );
}