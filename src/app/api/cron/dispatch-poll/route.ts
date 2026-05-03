import { NextRequest, NextResponse } from "next/server";
import { refreshDispatchSnapshot } from "@/lib/dispatch-hub";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const expectedToken = process.env.DISPATCH_CRON_SECRET?.trim();
  const authHeader = req.headers.get("authorization") ?? "";
  const providedToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  const isVercelCron =
    req.headers.get("user-agent")?.toLowerCase().includes("vercel-cron") ||
    Boolean(req.headers.get("x-vercel-id"));

  if (!isVercelCron && (!expectedToken || providedToken !== expectedToken)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 }
    );
  }

  try {
    const snapshot = await refreshDispatchSnapshot();

    return NextResponse.json({
      success: true,
      message: "Dispatch poll completed.",
      fetchedAt: snapshot.fetchedAt,
      revision: snapshot.revision,
      dispatchCount: snapshot.result.dispatches.length,
      upstreamStatus: snapshot.result.upstreamStatus,
    });
  } catch (error) {
    console.error("[cron dispatch-poll] failed", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}