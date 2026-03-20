import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionCookieName, readSessionToken } from "@/lib/unit-session";
import { fetchUnitWorkOrders } from "@/lib/work-orders";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  const unitId = readSessionToken(token);

  if (!unitId) {
    return NextResponse.json(
      { ok: false, message: "Not authenticated.", workOrders: [] },
      { status: 401 },
    );
  }

  const result = await fetchUnitWorkOrders(unitId);

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
