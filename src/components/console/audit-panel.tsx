import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatShopTime } from "@/lib/data/clock";
import type { AuditSnapshot } from "@/lib/types";
import { RotateCcw } from "lucide-react";

function jevAuditLine(payload: Record<string, unknown>): string | null {
  const choice = payload.jevChoice;
  const confidence = payload.jevConfidence;
  if (typeof choice !== "string" || typeof confidence !== "number") return null;
  const stance =
    payload.jevHardRuleBlocked === true
      ? "hard deny kept"
      : payload.jevApplied === true
        ? "used for this gate"
        : "advisory";
  return `Jev ${choice} · ${Math.round(confidence * 100)}% · ${stance} · decision aid`;
}

const actionLabel: Record<string, string> = {
  "ledger.genesis": "Opened",
  "spend.approve": "Approved",
  "spend.deny": "Denied",
  "spend.review": "Held",
  "sms.draft": "Drafted",
};

export function AuditPanel({
  audit,
  resetting,
  onReset,
}: {
  audit: AuditSnapshot;
  resetting: boolean;
  onReset: () => void;
}) {
  const newestFirst = [...audit.entries].reverse();
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Audit log">
      <header className="flex items-start justify-between gap-3 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium">Audit log</h2>
          <p className="text-xs text-muted-foreground">
            Append-only, hash-linked (CHP-lite)
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReset}
          disabled={resetting}
        >
          <RotateCcw />
          Reset demo
        </Button>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <ol className="flex flex-col gap-2 px-4 pb-3">
          {newestFirst.length === 0 ? (
            <li className="rounded-xl border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
              No entries yet. Cleared spend and denials land here.
            </li>
          ) : (
            newestFirst.map((entry) => (
              <li key={entry.id} className="rounded-xl bg-background/40 px-3 py-2.5 ring-1 ring-foreground/10">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline">{actionLabel[entry.action] ?? entry.action}</Badge>
                  <time className="text-[11px] text-muted-foreground" dateTime={entry.ts}>
                    {formatShopTime(entry.ts)}
                  </time>
                </div>
                <p className="mt-1.5 text-sm leading-snug">{entry.summary}</p>
                {jevAuditLine(entry.payload) ? (
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    {jevAuditLine(entry.payload)}
                  </p>
                ) : null}
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {entry.hash.slice(0, 12)} · {entry.actor}
                </p>
              </li>
            ))
          )}
        </ol>
      </ScrollArea>
      <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        {audit.intact ? "Chain intact" : "Chain broken"} · {audit.entries.length}{" "}
        {audit.entries.length === 1 ? "entry" : "entries"} · {audit.company}
      </p>
    </section>
  );
}
