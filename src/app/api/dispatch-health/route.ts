import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ensureDispatchPolling,
  getDispatchHubHealth,
  getDispatchSnapshot,
} from "@/lib/dispatch-hub";
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
    ensureDispatchPolling();
    await getDispatchSnapshot();

    return NextResponse.json(getDispatchHubHealth());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dispatch diagnostics unavailable.";

    return NextResponse.json(
      {
        ...getDispatchHubHealth(),
        ok: false,
        message,
      },
      { status: 200 },
    );
  }
}
