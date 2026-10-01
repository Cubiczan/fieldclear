"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { DraftCard as Draft } from "@/lib/types";

export function DraftCard({ draft }: { draft: Draft }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card size="sm" className="mt-3 bg-background/40">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-sm">
          <span>
            Text to {draft.toName}
            <span className="mt-0.5 block font-sans text-xs font-normal text-muted-foreground">
              {draft.customerName} · {draft.toPhone}
            </span>
          </span>
          <Badge variant="outline">Not sent</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-foreground/95">{draft.body}</p>
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <p className="text-xs text-muted-foreground">Draft only. sms.draft does not contact a carrier.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </CardFooter>
    </Card>
  );
}
