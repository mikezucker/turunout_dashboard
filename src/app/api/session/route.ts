import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getUnitProfile,
  readSessionToken,
  serializeUnitProfile,
  sessionCookieName,
} from "@/lib/unit-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  const unitId = readSessionToken(token);

  if (!unitId) {
    return NextResponse.json({ authenticated: false, unit: null });
  }

  const unit = getUnitProfile(unitId);

  if (!unit) {
    return NextResponse.json({ authenticated: false, unit: null });
  }

  return NextResponse.json({
    authenticated: true,
    unit: serializeUnitProfile(unit),
  });
}
