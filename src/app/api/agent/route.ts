import { runAgentLoop } from "@/lib/agent/loop";
import {
  parseClientLedger,
  runWithLedger,
  seedAuditSnapshot,
  sessionAudit,
} from "@/lib/data/store";
import type { StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * HTTP entry for the Alexa+ simulator.
 * Every utterance is handed to runAgentLoop, which calls the in-process tools.
 * The body is newline-delimited JSON (meta, step, done, error).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    utterance?: unknown;
    message?: unknown;
    ledger?: unknown;
  } | null;
  const raw = body?.utterance ?? body?.message;
  const utterance = typeof raw === "string" ? raw.trim() : "";

  if (!utterance) {
    return Response.json(
      { error: "Say what you need in one sentence." },
      { status: 400 },
    );
  }
  if (utterance.length > 500) {
    return Response.json(
      { error: "Keep it under 500 characters." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const ledger = parseClientLedger(body?.ledger) ?? seedAuditSnapshot().entries;
      try {
        await runWithLedger(ledger, async () => {
          await runAgentLoop({ utterance, onEvent: send });
          const audit = sessionAudit();
          if (audit) send({ type: "ledger", audit });
        });
      } catch {
        send({
          type: "error",
          message: "The agent loop stopped before it could answer.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
