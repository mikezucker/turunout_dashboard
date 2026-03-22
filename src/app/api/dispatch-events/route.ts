import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getIncidentEvents } from "@/lib/dispatch-store";
import {
  readSessionToken,
  sessionCookieName,
} from "@/lib/unit-session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  const unitId = readSessionToken(token);

  if (!unitId) {
    return NextResponse.json(
      { ok: false, message: "Not authenticated." },
      { status: 401 },
    );
  }

  const incidentId = request.nextUrl.searchParams.get("incidentId")?.trim();

  if (!incidentId) {
    return NextResponse.json(
      { ok: false, message: "incidentId is required." },
      { status: 400 },
    );
  }

  const events = await getIncidentEvents(incidentId);

  return NextResponse.json({
    ok: true,
    incidentId,
    events,
  });
}
