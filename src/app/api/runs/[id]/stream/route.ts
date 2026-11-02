import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { notFound } from "@/server/auth/errors";
import { runs } from "@/server/agent/runtime";
import { handler } from "@/server/http";
import type { RunEvent } from "@/lib/run-events";
import type { MessagePart } from "@/lib/parts";

type Ctx = { params: Promise<{ id: string }> };

/**
 * SSE stream of a run's events. Replays buffered events after `?after=<seq>`, then
 * streams live. If the run is no longer in memory, sends a single synthetic `done`.
 */
export const GET = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const after = Number(new URL(req.url).searchParams.get("after") ?? "0") || 0;

  const live = runs().get(id);
  if (live && live.userId !== user.id) throw notFound("Run");

  const encoder = new TextEncoder();
  const headers = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  };

  if (!live) {
    const run = await db.run.findFirst({
      where: { id, userId: user.id },
      include: { assistantMessage: true },
    });
    if (!run) throw notFound("Run");
    const m = run.assistantMessage;
    const done: RunEvent = {
      seq: Number.MAX_SAFE_INTEGER,
      type: "done",
      runStatus: run.status,
      messageStatus: m?.status ?? "STOPPED",
      parts: ((m?.parts as unknown as MessagePart[]) ?? []),
      error: run.error,
      usage: null,
      contextUsage: null,
      costMicros: 0,
      webSearchCalls: 0,
      steps: run.steps,
    };
    return new Response(encoder.encode(`data: ${JSON.stringify(done)}\n\n`), { headers });
  }

  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const send = (event: RunEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`));
        if (event.type === "done") close();
      };
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15_000);
      const unsubscribe = runs().subscribe(id, after, send);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe?.();
      };
      req.signal.addEventListener("abort", close);
      if (!unsubscribe) close();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers });
});
