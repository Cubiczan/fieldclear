import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ToolStep } from "@/lib/types";
import { cn } from "cn";

const captions: Record<string, string> = {
  "policy.check": "Spend policy",
  "ledger.append": "Audit log",
  "jobs.lookup": "Job board",
  "sms.draft": "Text draft",
};

export function toolCaption(name: string | null): string {
  if (!name) return "Waiting for a request";
  return captions[name] ?? name;
}

export function ToolTrail({
  steps,
  activeTool,
  running,
}: {
  steps: ToolStep[];
  activeTool: string | null;
  running: boolean;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Tool calls">
      <header className="flex items-end justify-between gap-3 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium">Tool calls</h2>
          <p className="text-xs text-muted-foreground">
            In-process MCP tools · listTools / callTool
          </p>
        </div>
        {running && activeTool ? (
          <Badge variant="secondary">{activeTool}</Badge>
        ) : null}
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <ol className="flex flex-col gap-2 px-4 pb-4">
          {steps.length === 0 ? (
            <li className="rounded-xl border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
              The trail fills as Alexa+ works. A parts clearance runs policy.check, then
              ledger.append. Nothing here is a remote skill call.
            </li>
          ) : (
            steps.map((step, index) => (
              <li
                key={step.id}
                className={cn(
                  "rounded-xl bg-background/40 px-3 py-2.5 ring-1 ring-foreground/10",
                  running && index === steps.length - 1 && "ring-primary/50",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-xs text-primary">
                    {index + 1}. {step.tool}
                  </p>
                  <span className="text-[11px] text-muted-foreground">
                    {step.ok ? "ok" : "error"} · {step.durationMs < 1 ? "<1" : step.durationMs} ms
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{toolCaption(step.tool)}</p>
                <p className="mt-1 text-sm leading-snug">{step.summary}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-muted-foreground">
                    Arguments and result
                  </summary>
                  <pre className="mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed text-foreground/80">
                    {JSON.stringify(
                      { arguments: step.arguments, result: step.structured },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </li>
            ))
          )}
        </ol>
      </ScrollArea>
    </section>
  );
}
