import type { McpToolDefinition } from "../mcp/types";
import type { JobsResult, PlannerKind, PolicyResult, SmsResult, ToolStep } from "../types";
import type { Intent } from "./intent";

export type Decision = {
  type: "tool" | "final";
  name?: string;
  arguments?: Record<string, unknown>;
  planner: PlannerKind;
  fellBack?: boolean;
  fallbackReason?: string;
};

export function decideHeuristic(
  intent: Intent,
  steps: ToolStep[],
): Decision {
  if (intent.kind === "spend") {
    if (intent.amountCents == null || intent.truckId == null) {
      return { type: "final", planner: "heuristic" };
    }
    if (!okStep(steps, "policy.check")) {
      return {
        type: "tool",
        planner: "heuristic",
        name: "policy.check",
        arguments: compact({
          amountCents: intent.amountCents,
          truckId: intent.truckId,
          category: intent.category,
          tradeHint: intent.tradeHint,
          memo: intent.memo,
        }),
      };
    }
    if (!okStep(steps, "ledger.append")) {
      const policy = lastStructured<PolicyResult>(steps, "policy.check");
      if (!policy) return { type: "final", planner: "heuristic" };
      const action =
        policy.decision === "approve"
          ? "spend.approve"
          : policy.decision === "deny"
            ? "spend.deny"
            : "spend.review";
      return {
        type: "tool",
        planner: "heuristic",
        name: "ledger.append",
        arguments: { action, policyDecisionId: policy.id },
      };
    }
    return { type: "final", planner: "heuristic" };
  }

  if (intent.kind === "lookup") {
    if (!okStep(steps, "jobs.lookup")) {
      return {
        type: "tool",
        planner: "heuristic",
        name: "jobs.lookup",
        arguments: compact({
          customer: intent.customerName,
          truckId: intent.truckId,
          when: intent.when,
        }),
      };
    }
    return { type: "final", planner: "heuristic" };
  }

  if (intent.kind === "sms") {
    if (!steps.some((step) => step.tool === "jobs.lookup")) {
      return {
        type: "tool",
        planner: "heuristic",
        name: "jobs.lookup",
        arguments: compact({
          customer: intent.customerName,
          truckId: intent.truckId,
          when: intent.when,
        }),
      };
    }
    const found = lastStructured<JobsResult>(steps, "jobs.lookup");
    if (!found || (found.jobs.length !== 1 && found.jobs.filter((job) => job.when === "tomorrow").length !== 1)) {
      if (!okStep(steps, "jobs.lookup")) return { type: "final", planner: "heuristic" };
    }
    if (!okStep(steps, "sms.draft")) {
      if (found && selectable(found)) {
        return {
          type: "tool",
          planner: "heuristic",
          name: "sms.draft",
          arguments: compact({
            customer: intent.customerName,
            truckId: intent.truckId,
            when: intent.when,
            jobId: found.jobs.length === 1 ? found.jobs[0].id : undefined,
          }),
        };
      }
      return { type: "final", planner: "heuristic" };
    }
    if (!okStep(steps, "ledger.append")) {
      const draft = lastStructured<SmsResult>(steps, "sms.draft");
      if (!draft) return { type: "final", planner: "heuristic" };
      return {
        type: "tool",
        planner: "heuristic",
        name: "ledger.append",
        arguments: { action: "sms.draft", draftId: draft.id },
      };
    }
    return { type: "final", planner: "heuristic" };
  }

  return { type: "final", planner: "heuristic" };
}

export function toolCatalogText(tools: McpToolDefinition[]): string {
  return tools
    .map(
      (tool) =>
        `${tool.name}: ${tool.description}\ninputSchema: ${JSON.stringify(tool.inputSchema)}`,
    )
    .join("\n\n");
}

function okStep(steps: ToolStep[], name: string): boolean {
  return steps.some((step) => step.tool === name && step.ok);
}

function selectable(result: JobsResult): boolean {
  if (result.jobs.length === 1) return true;
  return result.jobs.filter((job) => job.when === "tomorrow").length === 1;
}

export function lastStructured<T>(steps: ToolStep[], name: string): T | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.tool === name && step.ok && step.structured) {
      return step.structured as T;
    }
  }
  return null;
}

function compact(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== undefined && value !== null),
  );
}
