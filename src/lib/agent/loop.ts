/**
 * Alexa+ simulator host.
 *
 * Entry point: runAgentLoop().
 * Each turn: parse the utterance, ask the planner for one action, callTool(),
 * repeat until the planner finishes or the host checklist is satisfied.
 * Tool implementations live behind listTools/callTool (MCP-shaped, in-process).
 */

import { callTool, listTools } from "../mcp/registry";
import { nid } from "../ids";
import type { PlannerKind, StreamEvent, ToolStep } from "../types";
import { decideWithBedrock } from "./bedrock";
import { composeTurn } from "./compose";
import { parseIntent, type Intent } from "./intent";
import { decideHeuristic, lastStructured, type Decision } from "./planner";
import type { JobsResult, PolicyResult, SmsResult } from "../types";

const MAX_STEPS = 6;

export async function runAgentLoop(input: {
  utterance: string;
  onEvent: (event: StreamEvent) => void | Promise<void>;
}): Promise<void> {
  const intent = parseIntent(input.utterance);
  const tools = listTools();
  const steps: ToolStep[] = [];
  const bedrockOn = process.env.USE_BEDROCK === "true";
  let planner: PlannerKind = bedrockOn ? "bedrock" : "heuristic";
  let note = bedrockOn
    ? "Amazon Bedrock Converse is choosing tools. policy.check and ledger.append still run locally."
    : "Local heuristic planner. No model key required. Set USE_BEDROCK=true to use Amazon Bedrock Converse.";

  await input.onEvent({ type: "meta", planner, note });

  try {
    for (let index = 0; index < MAX_STEPS; index += 1) {
      const raw = await nextDecision(input.utterance, intent, steps, tools);
      if (raw.fellBack && planner !== "heuristic") {
        planner = "heuristic";
        note = `Bedrock was unavailable (${raw.fallbackReason ?? "call failed"}), so the local planner finished this turn.`;
        await input.onEvent({ type: "meta", planner, note });
      }

      const decision = enforce(intent, steps, raw);
      if (decision.type === "final" || !decision.name) {
        break;
      }

      const args = decision.arguments ?? {};
      const started = Date.now();
      const result = await callTool(decision.name, args);
      const step: ToolStep = {
        id: nid("step"),
        tool: decision.name,
        arguments: args,
        ok: !result.isError,
        summary: result.content[0]?.text ?? "",
        structured: result.structuredContent,
        durationMs: Date.now() - started,
      };
      steps.push(step);
      await input.onEvent({ type: "step", step });
    }

    await input.onEvent({
      type: "done",
      turn: composeTurn(input.utterance, steps),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The agent loop stopped unexpectedly.";
    await input.onEvent({
      type: "error",
      message: message.slice(0, 240),
    });
  }
}

async function nextDecision(
  utterance: string,
  intent: Intent,
  steps: ToolStep[],
  tools: ReturnType<typeof listTools>,
): Promise<Decision> {
  if (process.env.USE_BEDROCK === "true") {
    try {
      return await decideWithBedrock({ utterance, intent, steps, tools });
    } catch (error) {
      const fallback = decideHeuristic(intent, steps);
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : "Bedrock call failed";
      return {
        ...fallback,
        planner: "heuristic",
        fellBack: true,
        fallbackReason: reason.slice(0, 180),
      };
    }
  }
  return decideHeuristic(intent, steps);
}

/**
 * The host does not accept a final answer that skipped a required tool.
 * Bedrock may choose arguments; it may not skip policy.check on a spend,
 * or skip the draft on an SMS request.
 */
function enforce(intent: Intent, steps: ToolStep[], decision: Decision): Decision {
  if (decision.type === "tool" && decision.name) {
    const args = completeArgs(intent, steps, decision.name, decision.arguments ?? {});
    const duplicate = steps.some(
      (step) =>
        !step.ok &&
        step.tool === decision.name &&
        stable(step.arguments) === stable(args),
    );
    if (duplicate) return { type: "final", planner: decision.planner };
    return { ...decision, arguments: args };
  }

  const required = decideHeuristic(intent, steps);
  if (required.type === "tool") {
    return { ...required, planner: decision.planner };
  }
  return decision;
}

function completeArgs(
  intent: Intent,
  steps: ToolStep[],
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...args };
  if (name === "policy.check" && intent.kind === "spend") {
    if (next.amountCents == null && intent.amountCents != null) next.amountCents = intent.amountCents;
    if (next.truckId == null && intent.truckId) next.truckId = intent.truckId;
    if (next.category == null) next.category = intent.category;
    if (next.tradeHint == null && intent.tradeHint) next.tradeHint = intent.tradeHint;
    if (next.memo == null) next.memo = intent.memo;
  }
  if (name === "ledger.append") {
    const policy = lastStructured<PolicyResult>(steps, "policy.check");
    const draft = lastStructured<SmsResult>(steps, "sms.draft");
    const action = typeof next.action === "string" ? next.action : "";
    if (policy && (action.startsWith("spend.") || (!action && intent.kind === "spend" && !draft))) {
      next.policyDecisionId = next.policyDecisionId ?? policy.id;
      next.action =
        policy.decision === "approve"
          ? "spend.approve"
          : policy.decision === "deny"
            ? "spend.deny"
            : "spend.review";
    }
    if (draft && (action === "sms.draft" || (!action && intent.kind === "sms"))) {
      next.action = "sms.draft";
      next.draftId = next.draftId ?? draft.id;
    }
  }
  if (name === "jobs.lookup" && (intent.kind === "lookup" || intent.kind === "sms")) {
    if (next.customer == null && intent.customerName) next.customer = intent.customerName;
    if (next.truckId == null && intent.truckId) next.truckId = intent.truckId;
    if (next.when == null) next.when = intent.when;
  }
  if (name === "sms.draft" && intent.kind === "sms") {
    const found = lastStructured<JobsResult>(steps, "jobs.lookup");
    if (next.jobId == null && found?.jobs.length === 1) next.jobId = found.jobs[0].id;
    if (next.customer == null && intent.customerName) next.customer = intent.customerName;
    if (next.when == null) next.when = intent.when;
  }
  return next;
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}
