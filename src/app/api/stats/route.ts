import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { fetchDispatchStats } from "@/lib/stats";
import {
  getDispatchAliasTokens,
  getUnitProfile,
  readSessionToken,
  sessionCookieName,
} from "@/lib/unit-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  const unitId = readSessionToken(token);

  if (!unitId) {
    return NextResponse.json(
      { ok: false, message: "Not authenticated." },
      { status: 401 },
    );
  }

  const unit = getUnitProfile(unitId);

  if (!unit) {
    return NextResponse.json(
      { ok: false, message: "Unit not found." },
      { status: 404 },
    );
  }

  const result = await fetchDispatchStats({
    ...unit,
    dispatchAliases: getDispatchAliasTokens(unit),
  });

  return NextResponse.json(result, { status: 200 });
}
