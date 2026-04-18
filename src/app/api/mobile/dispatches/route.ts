import { NextRequest, NextResponse } from "next/server";
import {
  buildDispatchApiResponse,
  dispatchApiStatusCode,
} from "@/lib/dispatch-feed";
import { getDispatchSnapshot } from "@/lib/dispatch-hub";
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

  if (providedToken !== expectedToken) {
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
        fetchedAt: new Date().toISOString(),
        configured: false,
        upstreamStatus: auth.status,
        dispatches: [],
        message: auth.message,
        sourceLabel: null,
      },
      { status: auth.status },
    );
  }

  const unit = getUnitProfile(auth.unitId);

  if (!unit) {
    return NextResponse.json(
      {
        fetchedAt: new Date().toISOString(),
        configured: false,
        upstreamStatus: 404,
        dispatches: [],
        message: "Configured dispatch mobile unit was not found.",
        sourceLabel: null,
      },
      { status: 404 },
    );
  }

  try {
    const snapshot = await getDispatchSnapshot();
    const response = buildDispatchApiResponse(snapshot, unit.id);

    return NextResponse.json(response, {
      status: dispatchApiStatusCode(response),
    });
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