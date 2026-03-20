import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  fetchFirstDueDispatches,
  filterDispatchesForUnit,
} from "@/lib/dispatches";
import {
  getUnitProfile,
  getDispatchAliasTokens,
  readSessionToken,
  sessionCookieName,
} from "@/lib/unit-session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await fetchFirstDueDispatches();
    const cookieStore = await cookies();
    const token = cookieStore.get(sessionCookieName())?.value;
    const unitId = readSessionToken(token);
    const unit = unitId ? getUnitProfile(unitId) : null;
    const dispatches = filterDispatchesForUnit(
      result.dispatches,
      unit
        ? {
            ...unit,
            dispatchAliases: getDispatchAliasTokens(unit),
          }
        : null,
    );

    return NextResponse.json(
      {
        fetchedAt: new Date().toISOString(),
        ...result,
        dispatches,
      },
      {
        status:
          result.upstreamStatus && result.upstreamStatus >= 400
            ? result.upstreamStatus
            : 200,
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown polling error";

    return NextResponse.json(
      {
        fetchedAt: new Date().toISOString(),
        configured: true,
        upstreamStatus: 502,
        dispatches: [],
        message,
        sourceLabel: null,
      },
      { status: 502 },
    );
  }
}
