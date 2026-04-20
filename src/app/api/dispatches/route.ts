import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  buildDispatchApiResponseFromResult,
  dispatchApiStatusCode,
} from "@/lib/dispatch-feed";
import { fetchFirstDueDispatches } from "@/lib/dispatches";
import { readSessionToken, sessionCookieName } from "@/lib/unit-session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await fetchFirstDueDispatches();
    const cookieStore = await cookies();
    const token = cookieStore.get(sessionCookieName())?.value;
    const unitId = readSessionToken(token);
    const response = buildDispatchApiResponseFromResult(
      result,
      new Date().toISOString(),
      unitId,
    );

    return NextResponse.json(
      response,
      { status: dispatchApiStatusCode(response) },
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
