import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { fetchDashboardNotesForUnit } from "@/lib/dashboard-notes";
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
        stationNotes: [],
        officerNotes: [],
      },
      { status: 401 },
    );
  }

  const result = await fetchDashboardNotesForUnit(unitId);

  return NextResponse.json(result, { status: 200 });
}
