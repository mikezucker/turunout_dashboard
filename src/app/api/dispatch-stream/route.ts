import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      message: "Dispatch streaming is disabled. Poll /api/dispatches from the browser instead.",
    },
    { status: 410 },
  );
}
