import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  readSessionToken,
  sessionCookieName,
} from "@/lib/unit-session";
import {
  buildDispatchApiResponse,
  dispatchApiStatusCode,
} from "@/lib/dispatch-feed";
import { getDispatchSnapshot } from "@/lib/dispatch-hub";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getDispatchSnapshot();
    const cookieStore = await cookies();
    const token = cookieStore.get(sessionCookieName())?.value;
    const unitId = readSessionToken(token);
    const response = buildDispatchApiResponse(snapshot, unitId);

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
