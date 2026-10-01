import { formatDollars } from "../data/money";
import { appendEntry } from "../data/store";
import { textResult, type JsonSchema, type McpToolResult } from "../mcp/types";
import type { LedgerResult } from "../types";
import { getPolicyDecision } from "./policy";
import { getDraft } from "./sms";

const schema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: ["spend.approve", "spend.deny", "spend.review", "sms.draft"],
      description: "Audit action. Spend actions require a policyDecisionId from policy.check.",
    },
    policyDecisionId: {
      type: "string",
      description: "Id returned by policy.check. Required for spend actions.",
    },
    draftId: {
      type: "string",
      description: "Id returned by sms.draft. Required when action is sms.draft.",
    },
  },
};

/**
 * Append-only audit write (CHP-lite).
 * Spend rows are copied from the policy decision so a caller cannot approve a denied ticket.
 * SMS rows record a draft and never a send.
 */
export function appendLedger(args: Record<string, unknown>): McpToolResult {
  const action = args.action;
  if (
    action !== "spend.approve" &&
    action !== "spend.deny" &&
    action !== "spend.review" &&
    action !== "sms.draft"
  ) {
    return textResult(
      "action must be spend.approve, spend.deny, spend.review, or sms.draft.",
      null,
      true,
    );
  }

  if (action === "sms.draft") {
    const draftId = args.draftId;
    if (typeof draftId !== "string") {
      return textResult("sms.draft audit rows need a draftId from sms.draft.", null, true);
    }
    const draft = getDraft(draftId);
    if (!draft) {
      return textResult("That draft id is not on this session. Draft the text first.", null, true);
    }
    const summary = `Drafted a confirmation text to ${draft.toName} at ${draft.customerName}. Not sent.`;
    const entry = appendEntry({
      action,
      subject: draft.jobId,
      summary,
      payload: {
        jobId: draft.jobId,
        draftId: draft.id,
        toName: draft.toName,
        toPhone: draft.toPhone,
        customerName: draft.customerName,
        sent: false,
      },
    });
    const structured: LedgerResult = {
      entryId: entry.id,
      hash: entry.hash,
      action: entry.action,
      summary: entry.summary,
    };
    return textResult(
      `Appended sms.draft · ${entry.hash.slice(0, 8)} · not sent`,
      structured,
    );
  }

  const policyDecisionId = args.policyDecisionId;
  if (typeof policyDecisionId !== "string") {
    return textResult(
      "Spend audit rows need a policyDecisionId from policy.check. I won't write an approval without one.",
      null,
      true,
    );
  }
  const decision = getPolicyDecision(policyDecisionId);
  if (!decision) {
    return textResult(
      "That policy decision isn't in this session. Run policy.check first.",
      null,
      true,
    );
  }

  const expected =
    decision.decision === "approve"
      ? "spend.approve"
      : decision.decision === "deny"
        ? "spend.deny"
        : "spend.review";
  if (action !== expected) {
    return textResult(
      `policy.check returned ${decision.decision}, so the audit action has to be ${expected}.`,
      null,
      true,
    );
  }

  const verb =
    decision.decision === "approve"
      ? "Approved"
      : decision.decision === "deny"
        ? "Denied"
        : "Held for review";
  const summary = `${verb} ${formatDollars(decision.amountCents)} ${decision.category} for ${decision.truckLabel.toLowerCase()}${decision.customerName ? ` (${decision.customerName})` : ""}.`;
  const entry = appendEntry({
    action,
    subject: decision.truckId,
    summary,
    payload: {
      policyDecisionId: decision.id,
      truckId: decision.truckId,
      amountCents: decision.amountCents,
      category: decision.category,
      decision: decision.decision,
      jobId: decision.jobId,
      reason: decision.reason,
      ruleIds: decision.ruleIds,
      memo: decision.memo,
    },
  });
  const structured: LedgerResult = {
    entryId: entry.id,
    hash: entry.hash,
    action: entry.action,
    summary: entry.summary,
  };
  return textResult(
    `Appended ${action} · ${entry.hash.slice(0, 8)}`,
    structured,
  );
}

export const ledgerTool = {
  name: "ledger.append",
  description:
    "Append one hash-linked audit entry (CHP-lite). Refuses to approve spend unless policy.check already approved that decision. Refuses to mark an SMS as sent.",
  inputSchema: schema,
  call: appendLedger,
};
