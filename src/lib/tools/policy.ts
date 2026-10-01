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
import type { PolicyResult, SpendCategory, Trade } from "../types";
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

export function checkPolicy(args: Record<string, unknown>): McpToolResult {
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

  const result = evaluate({
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

  return textResult(
    `${lead} · ${result.truckLabel} · ${result.reason}`,
    result,
    false,
  );
}

function evaluate(input: {
  amountCents: number;
  truckId: string;
  category: SpendCategory;
  tradeHint?: Trade;
  memo: string;
}): PolicyResult {
  const truck = truckById(input.truckId);
  const base = {
    id: nid("pol"),
    amountCents: input.amountCents,
    truckId: input.truckId,
    truckLabel: truck ? `Truck ${truck.number}` : input.truckId,
    category: input.category,
    memo: input.memo,
  };

  if (!truck) {
    return {
      ...base,
      decision: "deny",
      ruleIds: ["POL-TRUCK"],
      reason: `I don't have a ${input.truckId.replace("-", " ")} on the board.`,
    };
  }

  const job = jobs.find((item) => item.truckId === truck.id);
  if (!job || truck.status === "idle") {
    return {
      ...base,
      truckLabel: `Truck ${truck.number}`,
      decision: "deny",
      ruleIds: ["POL-OPEN-JOB"],
      techName: truck.techName,
      reason: `Truck ${truck.number} doesn't have an open job, so there's nothing to clear spend against.`,
    };
  }

  const customer = customerById(job.customerId);
  const spent = dailyApprovedCents(truck.id);
  const remaining = POLICY.dailyTruckCapCents - spent;
  const limit = categoryLimit(input.category);
  const hard: string[] = [];
  const ruleIds: string[] = [];

  if (input.amountCents > limit) {
    ruleIds.push("POL-TICKET");
    hard.push(
      `${labelCategory(input.category)} tickets auto-clear only up to ${formatDollars(limit)}.`,
    );
  }
  if (input.amountCents > remaining) {
    ruleIds.push("POL-DAILY");
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

  if (hard.length > 0) {
    return {
      ...shared,
      decision: "deny",
      ruleIds,
      reason: hard.join(" "),
    };
  }

  if (input.tradeHint && input.tradeHint !== job.trade) {
    return {
      ...shared,
      decision: "needs_review",
      ruleIds: ["POL-TRADE"],
      reason: `Truck ${truck.number} is on a ${tradeLabel(job.trade).toLowerCase()} job (${job.title}${customer ? ` for ${customer.name}` : ""}). This request looks like ${tradeLabel(input.tradeHint).toLowerCase()} spend, so the office has to review it before I clear it.`,
    };
  }

  return {
    ...shared,
    decision: "approve",
    ruleIds: ["POL-TICKET", "POL-DAILY", "POL-OPEN-JOB"],
    reason: `${formatDollars(input.amountCents)} in ${input.category} is within the ${formatDollars(limit)} limit, and truck ${truck.number} still has room under today's ${formatDollars(POLICY.dailyTruckCapCents)} cap. The open job is ${job.title}${customer ? ` for ${customer.name}` : ""}.`,
  };
}

function labelCategory(category: SpendCategory): string {
  if (category === "other") return "Other";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export const policyTool = {
  name: "policy.check",
  description:
    "Approve, hold, or deny a spend ticket against Northline Mechanical policy (ticket limits, daily truck cap, open job, trade match). Does not write the audit log.",
  inputSchema: schema,
  call: checkPolicy,
};
