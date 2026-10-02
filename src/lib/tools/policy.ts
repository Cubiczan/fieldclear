import { nid } from "../ids";
import { formatDollars } from "../data/money";
import {
  POLICY,
  categoryLimit,
  customerById,
  jobs,
  tradeLabel,
  truckById,
} from "../data/seed";
import { dailyApprovedCents } from "../data/store";
import {
  applyJevSignal,
  evaluatePolicySignal,
  type PolicySignalState,
} from "../jev/client";
import type { JevGateView, PolicyDecisionName, PolicyResult, SpendCategory, Trade } from "../types";
import { textResult, type JsonSchema, type McpToolResult } from "../mcp/types";

const decisions = new Map<string, PolicyResult>();

const schema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["amountCents", "truckId", "category"],
  properties: {
    amountCents: {
      type: "integer",
      description: "Ticket amount in cents. $240 is 24000.",
    },
    truckId: {
      type: "string",
      description: 'Truck id such as "truck-3".',
    },
    category: {
      type: "string",
      enum: ["parts", "fuel", "tools", "other"],
      description: "Spend category checked against the ticket limit.",
    },
    tradeHint: {
      type: "string",
      enum: ["hvac", "plumbing", "electrical"],
      description: "Trade implied by the request, if the words say so.",
    },
    memo: {
      type: "string",
      description: "The dispatcher utterance, kept on the decision.",
    },
  },
};

const categories = new Set<SpendCategory>(["parts", "fuel", "tools", "other"]);
const trades = new Set<Trade>(["hvac", "plumbing", "electrical"]);

export function getPolicyDecision(id: string): PolicyResult | undefined {
  return decisions.get(id);
}

export async function checkPolicy(args: Record<string, unknown>): Promise<McpToolResult> {
  const amountCents = args.amountCents;
  const truckId = args.truckId;
  const category = args.category;
  const memo = typeof args.memo === "string" ? args.memo : "";
  const tradeHint = args.tradeHint;

  if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents <= 0) {
    return textResult("amountCents has to be a positive integer of cents.", null, true);
  }
  if (typeof truckId !== "string" || truckId.length === 0) {
    return textResult("truckId is required.", null, true);
  }
  if (typeof category !== "string" || !categories.has(category as SpendCategory)) {
    return textResult("category must be parts, fuel, tools, or other.", null, true);
  }
  if (tradeHint !== undefined && (typeof tradeHint !== "string" || !trades.has(tradeHint as Trade))) {
    return textResult("tradeHint must be hvac, plumbing, or electrical.", null, true);
  }

  const result = await evaluate({
    amountCents,
    truckId,
    category: category as SpendCategory,
    tradeHint: tradeHint as Trade | undefined,
    memo,
  });
  decisions.set(result.id, result);

  const lead =
    result.decision === "approve"
      ? `Approve ${formatDollars(result.amountCents)} ${result.category}`
      : result.decision === "needs_review"
        ? `Hold ${formatDollars(result.amountCents)} ${result.category}`
        : `Deny ${formatDollars(result.amountCents)} ${result.category}`;

  const jev = result.jev;
  const jevLine = jev
    ? `${jev.source === "api" ? "Jev" : "Local Jev fallback"} ${jev.choice} ${Math.round(jev.confidence * 100)}% (${jevStance(jev)}). Decision aid.`
    : "Decision aid.";

  return textResult(`${lead} · ${result.truckLabel} · ${result.reason} · ${jevLine}`, result, false);
}

function jevStance(jev: JevGateView): string {
  if (jev.hardRuleBlocked) return "hard deny kept";
  if (jev.applied) return "used for this gate";
  if (jev.primary) return "shop rule kept";
  return "advisory";
}

async function evaluate(input: {
  amountCents: number;
  truckId: string;
  category: SpendCategory;
  tradeHint?: Trade;
  memo: string;
}): Promise<PolicyResult> {
  const shop = shopRules(input);
  const signal = await evaluatePolicySignal(shop.state);
  const primary = process.env.JEV_PRIMARY === "true";
  const dualRun = process.env.JEV_DUAL_RUN === "true";
  const gate = applyJevSignal(shop.result.decision, signal, primary);
  const jev: JevGateView = {
    source: signal.source,
    model: signal.model,
    choice: signal.choice,
    confidence: signal.confidence,
    probabilities: signal.probabilities,
    nouls: signal.nouls,
    disclaimer: signal.disclaimer,
    applied: gate.applied,
    hardRuleBlocked: gate.hardRuleBlocked,
    primary,
    dualRun,
    shopDecision: shop.result.decision,
    jevDecision: gate.jevDecision,
    matchesShop: shop.result.decision === gate.jevDecision,
    ...(signal.fallbackReason ? { fallbackReason: signal.fallbackReason } : {}),
  };

  const tightened = gate.decision !== shop.result.decision;
  return {
    ...shop.result,
    decision: gate.decision,
    reason: tightened ? tightenedReason(shop.result.decision, gate.decision, signal) : shop.result.reason,
    ruleIds: tightened
      ? [...shop.result.ruleIds, gate.decision === "deny" ? "JEV-DENY" : "JEV-HOLD"]
      : [...shop.result.ruleIds, "JEV"],
    jev,
  };
}

function tightenedReason(
  shop: PolicyDecisionName,
  applied: PolicyDecisionName,
  signal: { source: "api" | "fallback"; choice: string; confidence: number },
): string {
  const who = signal.source === "api" ? "Jev" : "The local Jev fallback";
  const pct = Math.round(signal.confidence * 100);
  const shopVerb = shop === "approve" ? "cleared it" : "held it for the office";
  if (applied === "deny") {
    return `${who} marked this deny at ${pct}% confidence, so I won't clear it. Shop rules would have ${shopVerb}. This is a decision aid, not a clearance.`;
  }
  return `${who} marked this ${signal.choice} at ${pct}% confidence, so the office has to review it before I clear it. Shop rules would have ${shopVerb}. This is a decision aid, not a clearance.`;
}

function shopRules(input: {
  amountCents: number;
  truckId: string;
  category: SpendCategory;
  tradeHint?: Trade;
  memo: string;
}): { result: PolicyResult; state: PolicySignalState } {
  const truck = truckById(input.truckId);
  const limit = categoryLimit(input.category);
  const base = {
    id: nid("pol"),
    amountCents: input.amountCents,
    truckId: input.truckId,
    truckLabel: truck ? `Truck ${truck.number}` : input.truckId,
    category: input.category,
    memo: input.memo,
  };

  if (!truck) {
    const result: PolicyResult = {
      ...base,
      decision: "deny",
      ruleIds: ["POL-TRUCK"],
      reason: `I don't have a ${input.truckId.replace("-", " ")} on the board.`,
    };
    return {
      result,
      state: signalState(input, {
        truck: null,
        job: null,
        hardRuleIds: ["POL-TRUCK"],
        spentTodayCents: 0,
        remainingDailyCents: POLICY.dailyTruckCapCents,
        categoryLimitCents: limit,
      }),
    };
  }

  const job = jobs.find((item) => item.truckId === truck.id);
  const spent = dailyApprovedCents(truck.id);
  const remaining = POLICY.dailyTruckCapCents - spent;
  const customer = job ? customerById(job.customerId) : undefined;

  if (!job || truck.status === "idle") {
    const result: PolicyResult = {
      ...base,
      truckLabel: `Truck ${truck.number}`,
      decision: "deny",
      ruleIds: ["POL-OPEN-JOB"],
      techName: truck.techName,
      reason: `Truck ${truck.number} doesn't have an open job, so there's nothing to clear spend against.`,
    };
    return {
      result,
      state: signalState(input, {
        truck,
        job: null,
        hardRuleIds: ["POL-OPEN-JOB"],
        spentTodayCents: spent,
        remainingDailyCents: remaining,
        categoryLimitCents: limit,
      }),
    };
  }

  const hardRuleIds: string[] = [];
  const hard: string[] = [];
  if (input.amountCents > limit) {
    hardRuleIds.push("POL-TICKET");
    hard.push(
      `${labelCategory(input.category)} tickets auto-clear only up to ${formatDollars(limit)}.`,
    );
  }
  if (input.amountCents > remaining) {
    hardRuleIds.push("POL-DAILY");
    hard.push(
      `Truck ${truck.number} has ${formatDollars(Math.max(remaining, 0))} left on today's ${formatDollars(POLICY.dailyTruckCapCents)} cap.`,
    );
  }

  const shared = {
    ...base,
    truckLabel: `Truck ${truck.number}`,
    jobId: job.id,
    jobTitle: job.title,
    customerName: customer?.name,
    techName: truck.techName,
    remainingDailyCents: remaining,
  };
  const state = signalState(input, {
    truck,
    job: {
      id: job.id,
      title: job.title,
      trade: job.trade,
      status: job.status,
      when: job.when,
      windowLabel: job.windowLabel,
      notes: job.notes,
      customerName: customer?.name,
    },
    hardRuleIds,
    spentTodayCents: spent,
    remainingDailyCents: remaining,
    categoryLimitCents: limit,
  });

  if (hard.length > 0) {
    return {
      result: {
        ...shared,
        decision: "deny",
        ruleIds: hardRuleIds,
        reason: hard.join(" "),
      },
      state,
    };
  }

  if (input.tradeHint && input.tradeHint !== job.trade) {
    return {
      result: {
        ...shared,
        decision: "needs_review",
        ruleIds: ["POL-TRADE"],
        reason: `Truck ${truck.number} is on a ${tradeLabel(job.trade).toLowerCase()} job (${job.title}${customer ? ` for ${customer.name}` : ""}). This request looks like ${tradeLabel(input.tradeHint).toLowerCase()} spend, so the office has to review it before I clear it.`,
      },
      state,
    };
  }

  return {
    result: {
      ...shared,
      decision: "approve",
      ruleIds: ["POL-TICKET", "POL-DAILY", "POL-OPEN-JOB"],
      reason: `${formatDollars(input.amountCents)} in ${input.category} is within the ${formatDollars(limit)} limit, and truck ${truck.number} still has room under today's ${formatDollars(POLICY.dailyTruckCapCents)} cap. The open job is ${job.title}${customer ? ` for ${customer.name}` : ""}.`,
    },
    state,
  };
}

function signalState(
  input: {
    amountCents: number;
    category: SpendCategory;
    tradeHint?: Trade;
    memo: string;
  },
  ctx: {
    truck: PolicySignalState["truck"];
    job: PolicySignalState["job"];
    hardRuleIds: string[];
    spentTodayCents: number;
    remainingDailyCents: number;
    categoryLimitCents: number;
  },
): PolicySignalState {
  return {
    amountCents: input.amountCents,
    category: input.category,
    categoryLimitCents: ctx.categoryLimitCents,
    dailyCapCents: POLICY.dailyTruckCapCents,
    spentTodayCents: ctx.spentTodayCents,
    remainingDailyCents: ctx.remainingDailyCents,
    truck: ctx.truck,
    job: ctx.job,
    ...(input.tradeHint ? { tradeHint: input.tradeHint } : {}),
    memo: input.memo,
    hardRuleIds: ctx.hardRuleIds,
  };
}

function labelCategory(category: SpendCategory): string {
  if (category === "other") return "Other";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export const policyTool = {
  name: "policy.check",
  description:
    "Approve, hold, or deny a spend ticket against Northline Mechanical policy (ticket limits, daily truck cap, open job, trade match). Jev Choice and Noul score the same job state as a decision aid and cannot override a hard deny. Without JEV_API_KEY the score is a deterministic local fallback. Does not write the audit log.",
  inputSchema: schema,
  call: checkPolicy,
};
