import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createSessionToken,
  getUnitProfile,
  serializeUnitProfile,
  sessionCookieName,
} from "@/lib/unit-session";

export const dynamic = "force-dynamic";

type LoginBody = {
  unitId?: string;
  password?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as LoginBody;

  if (!body.unitId || !body.password) {
    return NextResponse.json(
      { ok: false, message: "Unit and password are required." },
      { status: 400 },
    );
  }

  const unit = getUnitProfile(body.unitId);

  if (!unit || unit.password !== body.password) {
    return NextResponse.json(
      { ok: false, message: "Invalid unit credentials." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({
    ok: true,
    unit: serializeUnitProfile(unit),
  });

  const cookieStore = await cookies();
  cookieStore.set({
    name: sessionCookieName(),
    value: createSessionToken(unit.id),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
