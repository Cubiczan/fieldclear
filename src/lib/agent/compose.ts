import { tomorrowLabel } from "../data/clock";
import { formatDollars } from "../data/money";
import type {
  ApprovalCard,
  AssistantTurn,
  DraftCard,
  JobsResult,
  PolicyResult,
  SmsResult,
  ToolStep,
} from "../types";
import { parseIntent } from "./intent";
import { lastStructured } from "./planner";

/** Spoken reply is composed from tool results so a planner cannot invent a clearance. */
export function composeTurn(utterance: string, steps: ToolStep[]): AssistantTurn {
  const intent = parseIntent(utterance);
  const policy = lastStructured<PolicyResult>(steps, "policy.check");
  const jobs = lastStructured<JobsResult>(steps, "jobs.lookup");
  const draft = lastStructured<SmsResult>(steps, "sms.draft");
  const ledgerOk = steps.some((step) => step.tool === "ledger.append" && step.ok);
  const ledgerFail = steps.some((step) => step.tool === "ledger.append" && !step.ok);

  const approval = policy ? toApproval(policy) : undefined;
  const draftCard = draft ? toDraft(draft) : undefined;

  if (intent.kind === "spend") {
    if (intent.amountCents == null) {
      return {
        say: "Tell me the amount and the truck. For example: clear a $240 parts order for truck 3.",
      };
    }
    if (intent.truckId == null) {
      return { say: "Which truck should I clear that against?" };
    }
    if (!policy) {
      const failed = steps.find((step) => step.tool === "policy.check" && !step.ok);
      return {
        say: failed
          ? `I couldn't check policy. ${failed.summary}`
          : "I didn't get a policy decision, so I didn't clear anything.",
      };
    }
    const logged = ledgerOk
      ? policy.decision === "approve"
        ? " It's on the audit log."
        : policy.decision === "deny"
          ? " I logged the denial."
          : " I logged the hold for the office."
      : ledgerFail
        ? " The audit write didn't land, so don't treat this as final."
        : "";
    if (policy.decision === "approve") {
      const jobBit = policy.jobTitle
        ? `${policy.techName ? `${policy.techName}'s ` : ""}${policy.jobTitle.toLowerCase()}${policy.customerName ? ` at ${policy.customerName}` : ""}`
        : policy.truckLabel.toLowerCase();
      return {
        say: `${policy.truckLabel} is clear. I approved ${formatDollars(policy.amountCents)} in ${policy.category} for ${jobBit}.${logged}`,
        approval,
      };
    }
    if (policy.decision === "needs_review") {
      return {
        say: `I'm holding ${formatDollars(policy.amountCents)} for ${policy.truckLabel.toLowerCase()}. ${policy.reason}${logged}`,
        approval,
      };
    }
    return {
      say: `I can't clear ${formatDollars(policy.amountCents)} for ${policy.truckLabel.toLowerCase()}. ${policy.reason}${logged}`,
      approval,
    };
  }

  if (intent.kind === "sms" || draftCard) {
    if (draftCard) {
      const logged = ledgerOk ? " I put the draft on the audit log." : "";
      return {
        say: `Here's a text for ${draftCard.toName} at ${draftCard.customerName}. I did not send it.${logged}`,
        draft: draftCard,
      };
    }
    const failed = [...steps].reverse().find((step) => !step.ok);
    return {
      say: failed?.summary ?? "I couldn't draft that text.",
    };
  }

  if (intent.kind === "lookup" || jobs) {
    return { say: speakJobs(jobs) };
  }

  return {
    say: "I can clear a parts, fuel, or tool charge, check what's pending, or draft a customer text. I won't send a text, and I won't clear spend the policy tool denies.",
  };
}

function toApproval(policy: PolicyResult): ApprovalCard {
  return {
    decision: policy.decision,
    reason: policy.reason,
    amountCents: policy.amountCents,
    truckLabel: policy.truckLabel,
    category: policy.category,
    jobTitle: policy.jobTitle,
    customerName: policy.customerName,
    ruleIds: policy.ruleIds,
    jev: policy.jev,
  };
}

function toDraft(draft: SmsResult): DraftCard {
  return {
    toName: draft.toName,
    toPhone: draft.toPhone,
    body: draft.body,
    jobId: draft.jobId,
    customerName: draft.customerName,
    sent: false,
  };
}

function speakJobs(result: JobsResult | null): string {
  if (!result || result.jobs.length === 0) {
    return result?.summary ?? "I don't have an open job for that.";
  }
  if (result.jobs.length === 1) {
    const job = result.jobs[0];
    const when =
      job.when === "tomorrow"
        ? `Tomorrow, ${tomorrowLabel()}, ${job.windowLabel}`
        : `Today, ${job.windowLabel}`;
    const pending =
      job.pending.length === 0
        ? "Nothing is still blocking it."
        : job.pending.length === 1
          ? `Still open: ${job.pending[0]}.`
          : `Still open: ${job.pending.join("; ")}.`;
    const note = job.notes[0] ? ` ${job.notes[0]}` : "";
    return `${job.customerName} has one open job. ${when}, ${job.techName} does the ${job.title.toLowerCase()} at ${job.address}. ${pending}${note}`;
  }
  const lines = result.jobs.map((job) => {
    const pending = job.pending.length ? ` Pending: ${job.pending.join("; ")}.` : "";
    return `${job.customerName}: ${job.title} on ${job.truckLabel.toLowerCase()} ${job.when} (${job.windowLabel}).${pending}`;
  });
  return `I have ${result.jobs.length} open jobs. ${lines.join(" ")}`;
}
