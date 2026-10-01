import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runAgentLoop } from "../src/lib/agent/loop";
import { auditSnapshot, resetDemoLedger } from "../src/lib/data/store";
import { listPrompts, listResources, listTools } from "../src/lib/mcp/registry";
import type { AssistantTurn, ToolStep } from "../src/lib/types";

process.env.FIELD_DATA_DIR = mkdtempSync(path.join(tmpdir(), "fieldclear-"));
delete process.env.USE_BEDROCK;

async function ask(utterance: string): Promise<{ turn: AssistantTurn; steps: ToolStep[] }> {
  const steps: ToolStep[] = [];
  let turn: AssistantTurn | null = null;
  await runAgentLoop({
    utterance,
    onEvent(event) {
      if (event.type === "step") steps.push(event.step);
      if (event.type === "done") turn = event.turn;
      if (event.type === "error") throw new Error(event.message);
    },
  });
  if (!turn) throw new Error(`No reply for: ${utterance}`);
  return { turn, steps };
}

async function main() {
  const tools = listTools().map((tool) => tool.name);
  assert.deepEqual(tools, [
    "policy.check",
    "ledger.append",
    "jobs.lookup",
    "sms.draft",
  ]);
  assert.ok(listPrompts().length >= 3);
  assert.equal(listResources()[0]?.uri, "fieldclear://policy/northline");

  resetDemoLedger();
  const denied = await ask("Clear a $2,400 compressor for truck 3");
  assert.equal(denied.turn.approval?.decision, "deny");
  assert.match(denied.turn.say, /can't clear/i);
  assert.deepEqual(
    denied.steps.map((step) => step.tool),
    ["policy.check", "ledger.append"],
  );
  assert.equal(denied.steps.every((step) => step.ok), true);

  resetDemoLedger();
  const cleared = await ask("Clear a $240 parts order for truck 3");
  assert.equal(cleared.turn.approval?.decision, "approve");
  assert.match(cleared.turn.say, /Truck 3 is clear/);
  assert.match(cleared.turn.say, /\$240/);
  assert.match(cleared.turn.say, /Acme Plumbing/);
  assert.deepEqual(
    cleared.steps.map((step) => step.tool),
    ["policy.check", "ledger.append"],
  );

  const pending = await ask("What's pending for Acme Plumbing?");
  assert.match(pending.turn.say, /water heater/i);
  assert.match(pending.turn.say, /confirmation text/i);
  assert.doesNotMatch(pending.turn.say, /not cleared/);
  assert.deepEqual(
    pending.steps.map((step) => step.tool),
    ["jobs.lookup"],
  );

  const drafted = await ask("Draft a customer SMS confirming tomorrow's install");
  assert.equal(drafted.turn.draft?.sent, false);
  assert.match(drafted.turn.draft?.body ?? "", /Jordan/);
  assert.match(drafted.turn.draft?.body ?? "", /YES/);
  assert.match(drafted.turn.say, /did not send/i);
  assert.deepEqual(
    drafted.steps.map((step) => step.tool),
    ["jobs.lookup", "sms.draft", "ledger.append"],
  );

  const after = await ask("What's pending for Acme Plumbing?");
  assert.match(after.turn.say, /Nothing is still blocking/);

  const puzzled = await ask("Tell me a joke about wrenches");
  assert.equal(puzzled.steps.length, 0);
  assert.match(puzzled.turn.say, /draft a customer text/i);

  const audit = auditSnapshot();
  assert.equal(audit.intact, true);
  assert.ok(
    audit.entries.some(
      (entry) => entry.action === "spend.approve" && entry.payload.amountCents === 24000,
    ),
  );
  assert.ok(
    audit.entries.some((entry) => entry.action === "sms.draft" && entry.payload.sent === false),
  );

  const idle = await ask("Clear $40 of fuel for truck 4");
  assert.equal(idle.turn.approval?.decision, "deny");
  assert.match(idle.turn.say, /open job/i);

  console.log("FieldClear agent loop ok");
  console.log(`  tools: ${tools.join(", ")}`);
  console.log(`  audit entries: ${audit.entries.length}, chain intact`);
  console.log(`  sample: ${cleared.turn.say}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
