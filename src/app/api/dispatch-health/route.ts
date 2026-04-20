import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { fetchFirstDueDispatches } from "@/lib/dispatches";
import { getFirstDueEnvDebug } from "@/lib/firstdue-env";
import {
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

  try {
    const result = await fetchFirstDueDispatches();
    const fetchedAt = new Date().toISOString();

    return NextResponse.json({
      ok: true,
      pollIntervalMs: 0,
      lockTtlMs: 0,
      retentionDays: 0,
      listeners: 0,
      revision: 0,
      snapshotFetchedAt: fetchedAt,
      snapshotUpstreamStatus: result.upstreamStatus,
      snapshotSourceLabel: result.sourceLabel,
      database: {
        configured: false,
        target: null,
      },
      redis: {
        configured: false,
        subscribed: false,
        clientStatus: "disabled",
        publisherStatus: "disabled",
        subscriberStatus: "disabled",
      },
      telemetry: {
        lastRefreshStartedAt: fetchedAt,
        lastRefreshCompletedAt: fetchedAt,
        lastSuccessfulFetchAt:
          result.upstreamStatus && result.upstreamStatus >= 200 && result.upstreamStatus < 300
            ? fetchedAt
            : null,
        lastFetchDurationMs: null,
        lastPersistDurationMs: null,
        lastPersistError: null,
        lastRefreshDurationMs: null,
        lastError:
          result.upstreamStatus && result.upstreamStatus >= 200 && result.upstreamStatus < 300
            ? null
            : result.message,
        lastResultMessage: result.message,
        lastUpstreamStatus: result.upstreamStatus,
      },
      firstDue: getFirstDueEnvDebug(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dispatch diagnostics unavailable.";

    return NextResponse.json(
      {
        firstDue: getFirstDueEnvDebug(),
        ok: false,
        message,
      },
      { status: 200 },
    );
  }
}
