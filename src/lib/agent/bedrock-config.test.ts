import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { runAgentLoop } from "./loop";
import { resetDemoLedger } from "../data/store";
import type { AssistantTurn } from "../types";
import {
  bedrockAuthMode,
  bedrockModelId,
  bedrockPlan,
  bedrockRegion,
  DEFAULT_AWS_REGION,
  DEFAULT_BEDROCK_MODEL_ID,
  bedrockEnabled,
} from "./bedrock-config";

process.env.FIELD_DATA_DIR = mkdtempSync(path.join(tmpdir(), "fieldclear-nova-"));

const saved = {
  nodeEnv: process.env.NODE_ENV,
  useBedrock: process.env.USE_BEDROCK,
  model: process.env.BEDROCK_MODEL_ID,
  region: process.env.AWS_REGION,
  vercel: process.env.VERCEL,
  role: process.env.AWS_ROLE_ARN,
  accessKey: process.env.AWS_ACCESS_KEY_ID,
  secret: process.env.AWS_SECRET_ACCESS_KEY,
};

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function setNodeEnv(value: "production" | "development" | undefined): void {
  const env = process.env as { NODE_ENV?: string };
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

function restoreEnv(): void {
  restore("NODE_ENV", saved.nodeEnv);
  restore("USE_BEDROCK", saved.useBedrock);
  restore("BEDROCK_MODEL_ID", saved.model);
  restore("AWS_REGION", saved.region);
  restore("VERCEL", saved.vercel);
  restore("AWS_ROLE_ARN", saved.role);
  restore("AWS_ACCESS_KEY_ID", saved.accessKey);
  restore("AWS_SECRET_ACCESS_KEY", saved.secret);
}

describe("bedrock plan", { concurrency: 1 }, () => {
test("production default is Amazon Nova Lite in us-east-1", () => {
  delete process.env.BEDROCK_MODEL_ID;
  delete process.env.AWS_REGION;
  delete process.env.USE_BEDROCK;
  setNodeEnv("production");
  delete process.env.VERCEL;
  assert.equal(bedrockEnabled(), true);
  assert.equal(bedrockModelId(), DEFAULT_BEDROCK_MODEL_ID);
  assert.equal(bedrockModelId(), "us.amazon.nova-lite-v1:0");
  assert.equal(bedrockRegion(), DEFAULT_AWS_REGION);
  assert.equal(bedrockAuthMode(), "chain");
  const plan = bedrockPlan();
  assert.equal(plan.kind, "bedrock");
  if (plan.kind === "bedrock") {
    assert.equal(plan.modelId, "us.amazon.nova-lite-v1:0");
    assert.match(plan.note, /Nova Lite/);
    assert.doesNotMatch(plan.modelId, /anthropic|claude/i);
  }
  restoreEnv();
});

test("development stays on the local planner unless USE_BEDROCK=true", () => {
  delete process.env.USE_BEDROCK;
  setNodeEnv("development");
  assert.equal(bedrockEnabled(), false);
  assert.equal(bedrockPlan().kind, "heuristic");

  process.env.USE_BEDROCK = "true";
  delete process.env.VERCEL;
  delete process.env.BEDROCK_MODEL_ID;
  assert.equal(bedrockPlan().kind, "bedrock");
  restoreEnv();
});

test("USE_BEDROCK=false keeps production offline", () => {
  setNodeEnv("production");
  process.env.USE_BEDROCK = "false";
  process.env.AWS_ROLE_ARN = "arn:aws:iam::123456789012:role/fieldclear-bedrock";
  process.env.VERCEL = "1";
  assert.equal(bedrockEnabled(), false);
  assert.equal(bedrockPlan().kind, "heuristic");
  restoreEnv();
});

test("anthropic and claude model ids are refused", () => {
  for (const id of [
    "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "us.anthropic.claude-3-5-haiku-20241022-v1:0",
    "anthropic.claude-sonnet-4-5-20250929-v1:0",
  ]) {
    process.env.BEDROCK_MODEL_ID = id;
    assert.throws(() => bedrockModelId(), /Nova Lite/);
    process.env.USE_BEDROCK = "true";
    delete process.env.VERCEL;
    const plan = bedrockPlan();
    assert.equal(plan.kind, "heuristic");
    assert.match(plan.note, /Refusing BEDROCK_MODEL_ID/);
  }
  process.env.BEDROCK_MODEL_ID = "amazon.nova-lite-v1:0";
  assert.equal(bedrockModelId(), "amazon.nova-lite-v1:0");
  restoreEnv();
});

test("Vercel without AWS_ROLE_ARN does not call Bedrock", async () => {
  setNodeEnv("production");
  delete process.env.USE_BEDROCK;
  process.env.VERCEL = "1";
  delete process.env.AWS_ROLE_ARN;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  assert.equal(bedrockAuthMode(), "missing");
  assert.equal(bedrockPlan().kind, "heuristic");

  resetDemoLedger();
  const seen: { planner: string; turn: AssistantTurn | null } = { planner: "", turn: null };
  await runAgentLoop({
    utterance: "Clear a $240 parts order for truck 3",
    onEvent(event) {
      if (event.type === "meta") seen.planner = event.planner;
      if (event.type === "done") seen.turn = event.turn;
      if (event.type === "error") throw new Error(event.message);
    },
  });
  assert.equal(seen.planner, "heuristic");
  assert.equal(seen.turn?.approval?.decision, "approve");
  restoreEnv();
});

test("Vercel with AWS_ROLE_ARN selects OIDC and still defaults to Nova Lite", () => {
  process.env.VERCEL = "1";
  process.env.AWS_ROLE_ARN = "arn:aws:iam::123456789012:role/fieldclear-bedrock";
  process.env.USE_BEDROCK = "true";
  delete process.env.BEDROCK_MODEL_ID;
  const plan = bedrockPlan();
  assert.equal(plan.kind, "bedrock");
  if (plan.kind === "bedrock") {
    assert.equal(plan.auth, "oidc");
    assert.equal(plan.modelId, "us.amazon.nova-lite-v1:0");
    assert.match(plan.note, /Vercel OIDC/);
  }
  restoreEnv();
});
});
