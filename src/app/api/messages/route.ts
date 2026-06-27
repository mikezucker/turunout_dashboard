import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { fetchStationMessagesForUnit } from "@/lib/station-messages";
import { readSessionToken, sessionCookieName } from "@/lib/unit-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  const unitId = readSessionToken(token);

  if (!unitId) {
    return NextResponse.json(
      {
        ok: false,
        message: "Not authenticated.",
        stationNumber: null,
        messages: [],
      },
      { status: 401 },
    );
  }

  const result = await fetchStationMessagesForUnit(unitId);

  return NextResponse.json(result, { status: 200 });
}
