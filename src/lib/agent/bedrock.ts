import type { McpToolDefinition } from "../mcp/types";
import type { ToolStep } from "../types";
import type { Intent } from "./intent";
import { toolCatalogText, type Decision } from "./planner";

const SYSTEM = `You are the planner inside FieldClear, a simulated Alexa+ for a small mechanical shop.
You do not speak to the dispatcher. A separate composer writes the reply from tool results.
Choose the next action only.

Return JSON only, with no markdown fences:
{"type":"tool","name":"<tool>","arguments":{...}}
or
{"type":"final"}

Rules:
- A spend request must call policy.check before ledger.append.
- ledger.append for spend must include policyDecisionId from the policy.check result.
- Use action spend.approve, spend.deny, or spend.review to match that decision. Never flip a denial into an approval.
- A "what's pending" request calls jobs.lookup once, then final.
- A draft request calls jobs.lookup, then sms.draft, then ledger.append with action "sms.draft" and draftId. sms.draft never sends.
- amountCents is an integer number of cents. $240 is 24000.
- truckId looks like "truck-3".
- category is parts, fuel, tools, or other.
- Do not invent customers, trucks, or amounts.`;

/**
 * Amazon Bedrock Converse planner.
 * Used only when USE_BEDROCK=true. Credentials come from the default AWS chain
 * (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_REGION).
 */
export async function decideWithBedrock(input: {
  utterance: string;
  intent: Intent;
  steps: ToolStep[];
  tools: McpToolDefinition[];
}): Promise<Decision> {
  const region = process.env.AWS_REGION || "us-east-1";
  const modelId = process.env.BEDROCK_MODEL_ID || "us.amazon.nova-lite-v1:0";
  const { BedrockRuntimeClient, ConverseCommand } = await import(
    "@aws-sdk/client-bedrock-runtime"
  );

  const client = new BedrockRuntimeClient({ region });
  const transcript = input.steps
    .map(
      (step, index) =>
        `${index + 1}. ${step.tool} args=${JSON.stringify(step.arguments)} ok=${step.ok} summary=${step.summary} structured=${JSON.stringify(step.structured)}`,
    )
    .join("\n");

  const user = [
    `Utterance: ${input.utterance}`,
    `Host intent hint: ${JSON.stringify(input.intent)}`,
    "",
    "Tools:",
    toolCatalogText(input.tools),
    "",
    transcript ? `Completed calls:\n${transcript}` : "Completed calls: none",
    "",
    "Return the next JSON action.",
  ].join("\n");

  const response = await client.send(
    new ConverseCommand({
      modelId,
      system: [{ text: SYSTEM }],
      messages: [{ role: "user", content: [{ text: user }] }],
      inferenceConfig: { maxTokens: 700, temperature: 0 },
    }),
  );

  const text =
    response.output?.message?.content
      ?.map((block) => ("text" in block ? block.text : ""))
      .join("")
      .trim() ?? "";

  return parseDecision(text);
}

function parseDecision(raw: string): Decision {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Bedrock did not return JSON.");
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
    type?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  };
  if (parsed.type === "final") {
    return { type: "final", planner: "bedrock" };
  }
  if (parsed.type === "tool" && typeof parsed.name === "string") {
    return {
      type: "tool",
      planner: "bedrock",
      name: parsed.name,
      arguments: parsed.arguments ?? {},
    };
  }
  throw new Error("Bedrock JSON was missing type tool|final.");
}
