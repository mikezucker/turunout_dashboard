import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getOrSetTtlCache } from "@/lib/ttl-cache";
import {
  ensureDispatchPolling,
  getDispatchHubHealth,
  getDispatchSnapshot,
} from "@/lib/dispatch-hub";
import { getFirstDueEnvDebug } from "@/lib/firstdue-env";
import {
  readSessionToken,
  sessionCookieName,
} from "@/lib/unit-session";

export const dynamic = "force-dynamic";
const DISPATCH_HEALTH_CACHE_TTL_MS = 55 * 1000;

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
    const result = await getOrSetTtlCache(
      "dispatch-health",
      DISPATCH_HEALTH_CACHE_TTL_MS,
      async () => {
        ensureDispatchPolling();
        await getDispatchSnapshot();

        return {
          ...getDispatchHubHealth(),
          firstDue: getFirstDueEnvDebug(),
        };
      },
    );

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dispatch diagnostics unavailable.";

    return NextResponse.json(
      {
        ...getDispatchHubHealth(),
        firstDue: getFirstDueEnvDebug(),
        ok: false,
        message,
      },
      { status: 200 },
    );
  }
}
