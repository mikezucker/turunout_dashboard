import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getUnitProfile,
  readSessionToken,
  serializeUnitProfile,
  sessionCookieName,
} from "@/lib/unit-session";
import { getOrSetTtlCache } from "@/lib/ttl-cache";
import { fetchLiveWeather } from "@/lib/weather";

export const dynamic = "force-dynamic";
const WEATHER_CACHE_TTL_MS = 4 * 60 * 1000;

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  const unitId = readSessionToken(token);

  if (!unitId) {
    return NextResponse.json(
      { ok: false, message: "Not authenticated.", unit: null },
      { status: 401 },
    );
  }

  const unit = getUnitProfile(unitId);

  if (!unit) {
    return NextResponse.json(
      { ok: false, message: "Unit not found.", unit: null },
      { status: 404 },
    );
  }

  const weather = await getOrSetTtlCache(
    `weather:${unitId}`,
    WEATHER_CACHE_TTL_MS,
    () => fetchLiveWeather(unit),
  );

  return NextResponse.json({
    ok: weather.isLive,
    message: weather.isLive ? null : weather.details[0] ?? null,
    unit: serializeUnitProfile(unit, weather),
  });
}
