import { NextResponse } from "next/server";
import { getOrSetTtlCache } from "@/lib/ttl-cache";
import { fetchDailySchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";
const SCHEDULE_CACHE_TTL_MS = 4 * 60 * 1000;

export async function GET() {
  const result = await getOrSetTtlCache(
    "daily-schedule",
    SCHEDULE_CACHE_TTL_MS,
    fetchDailySchedule,
  );

  return NextResponse.json(result, { status: 200 });
}
