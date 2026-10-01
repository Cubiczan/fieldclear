import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDollars } from "@/lib/data/money";
import type { ApprovalCard as Approval } from "@/lib/types";
import { cn } from "cn";

const copy = {
  approve: { label: "Approved", tone: "border-approve text-approve" },
  deny: { label: "Denied", tone: "border-deny text-deny" },
  needs_review: { label: "Needs review", tone: "border-hold text-hold" },
} as const;

export function ApprovalCard({ approval }: { approval: Approval }) {
  const tone = copy[approval.decision];
  return (
    <Card
      size="sm"
      className={cn("mt-3 border-l-4 bg-background/40", tone.tone)}
    >
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className={cn("text-xs font-medium tracking-[0.14em] uppercase", tone.tone)}>
            {tone.label}
          </p>
          <p className="font-display text-3xl leading-none text-foreground">
            {formatDollars(approval.amountCents)}
          </p>
        </div>
        <p className="text-sm text-foreground/90">
          {approval.category} · {approval.truckLabel}
          {approval.jobTitle ? ` · ${approval.jobTitle}` : ""}
          {approval.customerName ? ` · ${approval.customerName}` : ""}
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">{approval.reason}</p>
        <div className="flex flex-wrap gap-1.5">
          {approval.ruleIds.map((rule) => (
            <Badge key={rule} variant="outline">
              {rule}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
