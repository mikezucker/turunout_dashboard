import { cookies } from "next/headers";
import {
  buildDispatchApiResponse,
  type DispatchSnapshot,
} from "@/lib/dispatch-feed";
import {
  getDispatchSnapshot,
  subscribeToDispatches,
} from "@/lib/dispatch-hub";
import {
  readSessionToken,
  sessionCookieName,
} from "@/lib/unit-session";

export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "Content-Type": "text/event-stream; charset=utf-8",
};

function formatSseEvent(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  const unitId = readSessionToken(token);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendSnapshot = (snapshot: DispatchSnapshot) => {
        const response = buildDispatchApiResponse(snapshot, unitId);
        controller.enqueue(
          encoder.encode(formatSseEvent("dispatch", response)),
        );
      };

      const initialSnapshot = await getDispatchSnapshot();
      sendSnapshot(initialSnapshot);

      const unsubscribe = subscribeToDispatches((snapshot) => {
        sendSnapshot(snapshot);
      });
      const heartbeatId = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15000);

      const cleanup = () => {
        unsubscribe();
        clearInterval(heartbeatId);
      };

      request.signal.addEventListener("abort", () => {
        cleanup();
        controller.close();
      });
    },
    cancel() {
      return;
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
