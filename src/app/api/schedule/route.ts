import { NextResponse } from "next/server";
import { fetchDailySchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await fetchDailySchedule();

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
