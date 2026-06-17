import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCentralDispatchSnapshot } from "@/lib/central-dispatch-feed";
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
    const startedAt = Date.now();
    const snapshot = await getCentralDispatchSnapshot();
    const completedAt = Date.now();

    return NextResponse.json({
      ok: snapshot.result.upstreamStatus
        ? snapshot.result.upstreamStatus < 400
        : snapshot.result.dispatches.length > 0,
      pollIntervalMs: 0,
      lockTtlMs: 0,
      retentionDays: 0,
      listeners: 0,
      revision: snapshot.revision,
      snapshotFetchedAt: snapshot.fetchedAt,
      snapshotUpstreamStatus: snapshot.result.upstreamStatus,
      snapshotSourceLabel: snapshot.result.sourceLabel,
      activeDispatchCount: snapshot.result.dispatches.length,
      database: {
        configured: true,
        target: "MTFD Site",
      },
      redis: {
        configured: false,
        subscribed: false,
        clientStatus: "not used",
        publisherStatus: "not used",
        subscriberStatus: "not used",
      },
      telemetry: {
        lastRefreshStartedAt: new Date(startedAt).toISOString(),
        lastRefreshCompletedAt: new Date(completedAt).toISOString(),
        lastSuccessfulFetchAt:
          snapshot.result.upstreamStatus && snapshot.result.upstreamStatus >= 400
            ? null
            : snapshot.fetchedAt,
        lastFetchDurationMs: completedAt - startedAt,
        lastPersistDurationMs: null,
        lastPersistError: null,
        lastRefreshDurationMs: completedAt - startedAt,
        lastError:
          snapshot.result.upstreamStatus && snapshot.result.upstreamStatus >= 400
            ? snapshot.result.message
            : null,
        lastResultMessage: snapshot.result.message,
        lastUpstreamStatus: snapshot.result.upstreamStatus,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dispatch diagnostics unavailable.";

    return NextResponse.json(
      {
        ok: false,
        message,
        pollIntervalMs: 0,
        lockTtlMs: 0,
        retentionDays: 0,
        listeners: 0,
        revision: 0,
        snapshotFetchedAt: null,
        snapshotUpstreamStatus: null,
        snapshotSourceLabel: "MTFD Site dispatch feed",
        activeDispatchCount: 0,
        database: {
          configured: true,
          target: "MTFD Site",
        },
        redis: {
          configured: false,
          subscribed: false,
          clientStatus: "not used",
          publisherStatus: "not used",
          subscriberStatus: "not used",
        },
        telemetry: {
          lastRefreshStartedAt: null,
          lastRefreshCompletedAt: null,
          lastSuccessfulFetchAt: null,
          lastFetchDurationMs: null,
          lastPersistDurationMs: null,
          lastPersistError: null,
          lastRefreshDurationMs: null,
          lastError: message,
          lastResultMessage: message,
          lastUpstreamStatus: null,
        },
      },
      { status: 200 },
    );
  }
}
