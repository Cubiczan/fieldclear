import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { checkPolicy } from "../tools/policy";
import type { PolicyResult } from "../types";
import {
  applyJevSignal,
  DEFAULT_JEV_MODEL,
  evaluatePolicySignal,
  fallbackPolicySignal,
  JEV_DISCLAIMER,
  JEV_ENDPOINT,
  proposeJevDecision,
  type JevPolicySignal,
  type PolicySignalState,
} from "./client";

process.env.FIELD_DATA_DIR = mkdtempSync(path.join(tmpdir(), "fieldclear-jev-"));

const saved = {
  key: process.env.JEV_API_KEY,
  primary: process.env.JEV_PRIMARY,
  dual: process.env.JEV_DUAL_RUN,
  model: process.env.JEV_MODEL,
};

function restoreEnv(): void {
  restore("JEV_API_KEY", saved.key);
  restore("JEV_PRIMARY", saved.primary);
  restore("JEV_DUAL_RUN", saved.dual);
  restore("JEV_MODEL", saved.model);
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function clearJevEnv(): void {
  delete process.env.JEV_API_KEY;
  delete process.env.JEV_PRIMARY;
  delete process.env.JEV_DUAL_RUN;
  delete process.env.JEV_MODEL;
}

function baseState(overrides: Partial<PolicySignalState> = {}): PolicySignalState {
  return {
    amountCents: 24000,
    category: "parts",
    categoryLimitCents: 50000,
    dailyCapCents: 80000,
    spentTodayCents: 0,
    remainingDailyCents: 80000,
    truck: {
      id: "truck-3",
      number: 3,
      trade: "plumbing",
      status: "on_job",
      techName: "Luis Ortega",
    },
    job: {
      id: "job-1042",
      title: "Water heater install",
      trade: "plumbing",
      status: "waiting_parts",
      when: "tomorrow",
      windowLabel: "9:00–11:00",
      notes: ["Certificate of insurance is already on file."],
      customerName: "Acme Plumbing",
    },
    memo: "Clear a $240 parts order for truck 3",
    hardRuleIds: [],
    ...overrides,
  };
}

function signal(overrides: Partial<JevPolicySignal> = {}): JevPolicySignal {
  return {
    source: "api",
    model: DEFAULT_JEV_MODEL,
    choice: "approve",
    confidence: 0.9,
    probabilities: { approve: 0.9, hold: 0.08, deny: 0.02 },
    nouls: {
      withinHardCaps: 1,
      tradeMismatch: 0,
      notesNeedReview: 0,
      slaPressure: 0.1,
    },
    disclaimer: JEV_DISCLAIMER,
    ...overrides,
  };
}

function apiPayload(choice: "approve" | "hold" | "deny", confidence: number) {
  return {
    model: "jev-1.13.0",
    answers: {
      decision: {
        type: "choice",
        choice,
        confidence,
        probabilities: {
          approve: choice === "approve" ? confidence : 0.05,
          hold: choice === "hold" ? confidence : 0.05,
          deny: choice === "deny" ? confidence : 0.05,
        },
      },
      within_hard_caps: { type: "noul", noul: 0.96 },
      trade_mismatch: { type: "noul", noul: 0.04 },
      notes_need_review: { type: "noul", noul: 0.08 },
      sla_pressure: { type: "noul", noul: 0.2 },
    },
    usage: { input_tokens: 120, output_tokens: 24 },
  };
}

test.after(restoreEnv);

test("fallback is deterministic and does not call the network", async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    throw new Error("network");
  };
  const state = baseState();
  const first = await evaluatePolicySignal(state, { apiKey: null, fetchImpl });
  const second = await evaluatePolicySignal(state, { apiKey: null, fetchImpl });
  assert.equal(called, false);
  assert.deepEqual(first, second);
  assert.equal(first.source, "fallback");
  assert.equal(first.model, "fieldclear-jev-fallback");
  assert.equal(first.choice, "approve");
  assert.equal(first.confidence, 0.93);
  assert.equal(first.nouls.withinHardCaps, 1);
  assert.equal(first.nouls.slaPressure, 0.55);
  assert.equal(first.disclaimer, JEV_DISCLAIMER);
  assert.equal(first.fallbackReason, undefined);
});

test("fallback holds a trade mismatch and denies a hard cap", () => {
  const mismatch = fallbackPolicySignal(
    baseState({ tradeHint: "hvac", job: { ...baseState().job!, trade: "plumbing" } }),
  );
  assert.equal(mismatch.choice, "hold");
  assert.equal(mismatch.nouls.tradeMismatch, 1);
  assert.equal(mismatch.confidence, 0.91);

  const notes = fallbackPolicySignal(
    baseState({ memo: "Please hold this for office review" }),
  );
  assert.equal(notes.choice, "hold");
  assert.equal(notes.nouls.notesNeedReview, 1);

  const urgent = fallbackPolicySignal(baseState({ memo: "Need this asap for truck 3" }));
  assert.equal(urgent.choice, "hold");
  assert.equal(urgent.nouls.slaPressure, 0.9);

  const denied = fallbackPolicySignal(baseState({ hardRuleIds: ["POL-TICKET", "POL-DAILY"] }));
  assert.equal(denied.choice, "deny");
  assert.equal(denied.nouls.withinHardCaps, 0);
  assert.equal(denied.confidence, 0.97);
});

test("weak Choice and high Noul escalate, and a hard deny is never loosened", () => {
  assert.equal(proposeJevDecision(signal({ choice: "approve", confidence: 0.55 })), "needs_review");
  assert.equal(
    proposeJevDecision(signal({ nouls: { ...signal().nouls, tradeMismatch: 0.8 } })),
    "needs_review",
  );
  assert.equal(
    proposeJevDecision(signal({ nouls: { ...signal().nouls, slaPressure: 0.91 } })),
    "needs_review",
  );

  const blocked = applyJevSignal("deny", signal({ choice: "approve", confidence: 0.99 }), true);
  assert.equal(blocked.decision, "deny");
  assert.equal(blocked.applied, false);
  assert.equal(blocked.hardRuleBlocked, true);

  const tightened = applyJevSignal("approve", signal({ choice: "hold", confidence: 0.8 }), true);
  assert.equal(tightened.decision, "needs_review");
  assert.equal(tightened.applied, true);

  const kept = applyJevSignal("needs_review", signal({ choice: "approve", confidence: 0.95 }), true);
  assert.equal(kept.decision, "needs_review");
  assert.equal(kept.applied, false);

  const advisory = applyJevSignal("approve", signal({ choice: "hold", confidence: 0.8 }), false);
  assert.equal(advisory.decision, "approve");
  assert.equal(advisory.applied, false);
});

test("a key posts Choice and Noul to System One and parses the answer", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(apiPayload("hold", 0.81));
  };

  const state = baseState();
  const result = await evaluatePolicySignal(state, {
    apiKey: "jev-test-key",
    model: "jev-1.13.0",
    fetchImpl,
    retryDelayMs: 0,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, JEV_ENDPOINT);
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get("Authorization"), "Bearer jev-test-key");
  assert.equal(headers.get("Content-Type"), "application/json");
  const body = JSON.parse(String(calls[0]?.init?.body)) as {
    model: string;
    state: PolicySignalState;
    questions: Record<string, { type: string }>;
  };
  assert.equal(body.model, DEFAULT_JEV_MODEL);
  assert.equal(body.state.amountCents, 24000);
  assert.equal(body.questions.decision?.type, "choice");
  assert.equal(body.questions.within_hard_caps?.type, "noul");
  assert.equal(body.questions.trade_mismatch?.type, "noul");
  assert.equal(body.questions.notes_need_review?.type, "noul");
  assert.equal(body.questions.sla_pressure?.type, "noul");
  assert.equal(JSON.stringify(body).includes("555-"), false);
  assert.equal(result.source, "api");
  assert.equal(result.choice, "hold");
  assert.equal(result.confidence, 0.81);
  assert.equal(result.model, "jev-1.13.0");
});

test("nested result.answers and a missing key both behave", async () => {
  const fetchImpl: typeof fetch = async () =>
    Response.json({
      result: {
        model: "jev-1.13.0",
        answers: apiPayload("approve", 0.88).answers,
      },
    });
  const parsed = await evaluatePolicySignal(baseState(), {
    apiKey: "jev-test-key",
    fetchImpl,
  });
  assert.equal(parsed.source, "api");
  assert.equal(parsed.choice, "approve");
  assert.equal(parsed.confidence, 0.88);

  let called = false;
  const blocked: typeof fetch = async () => {
    called = true;
    throw new Error("should not run");
  };
  delete process.env.JEV_API_KEY;
  const missed = await evaluatePolicySignal(baseState(), { fetchImpl: blocked });
  assert.equal(called, false);
  assert.equal(missed.source, "fallback");
});

test("HTTP 401, a bad payload, and a timeout fall back; 429 retries once", async () => {
  const unauthorized = await evaluatePolicySignal(baseState(), {
    apiKey: "jev-test-key",
    fetchImpl: async () => new Response("no", { status: 401 }),
  });
  assert.equal(unauthorized.source, "fallback");
  assert.match(unauthorized.fallbackReason ?? "", /401/);
  assert.equal(unauthorized.choice, "approve");

  const broken = await evaluatePolicySignal(baseState(), {
    apiKey: "jev-test-key",
    fetchImpl: async () => Response.json({ answers: { decision: { choice: "maybe" } } }),
  });
  assert.equal(broken.source, "fallback");
  assert.match(broken.fallbackReason ?? "", /usable decision/);

  const hung: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      const abort = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (init?.signal?.aborted) abort();
      init?.signal?.addEventListener("abort", abort);
    });
  const timed = await evaluatePolicySignal(baseState(), {
    apiKey: "jev-test-key",
    fetchImpl: hung,
    timeoutMs: 20,
  });
  assert.equal(timed.source, "fallback");
  assert.match(timed.fallbackReason ?? "", /timed out/);

  let attempts = 0;
  const retried = await evaluatePolicySignal(baseState(), {
    apiKey: "jev-test-key",
    retryDelayMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return new Response("busy", { status: 429 });
      return Response.json(apiPayload("approve", 0.92));
    },
  });
  assert.equal(attempts, 2);
  assert.equal(retried.source, "api");
  assert.equal(retried.choice, "approve");
});

test("policy.check uses the fallback and keeps shop rules unless Jev is primary", async () => {
  clearJevEnv();
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("network");
  };
  try {
    const cleared = await decisionOf({
      amountCents: 24000,
      truckId: "truck-3",
      category: "parts",
      memo: "Clear a $240 parts order for truck 3",
    });
    assert.equal(called, false);
    assert.equal(cleared.decision, "approve");
    assert.equal(cleared.jev?.source, "fallback");
    assert.equal(cleared.jev?.choice, "approve");
    assert.equal(cleared.jev?.applied, false);
    assert.match(cleared.jev?.disclaimer ?? "", /Decision aid/);
    assert.equal(JSON.stringify(cleared).includes("555-"), false);

    const denied = await decisionOf({
      amountCents: 240000,
      truckId: "truck-3",
      category: "parts",
      memo: "Clear a $2,400 compressor for truck 3",
      tradeHint: "hvac",
    });
    assert.equal(denied.decision, "deny");
    assert.equal(denied.jev?.hardRuleBlocked, true);
    assert.equal(denied.jev?.choice, "deny");

    const idle = await decisionOf({
      amountCents: 4000,
      truckId: "truck-4",
      category: "fuel",
      memo: "Clear $40 of fuel for truck 4",
    });
    assert.equal(idle.decision, "deny");
    assert.match(idle.reason, /open job/i);
  } finally {
    globalThis.fetch = original;
  }
});

test("JEV_PRIMARY can tighten a clear, and a hard deny still wins", async () => {
  clearJevEnv();
  process.env.JEV_API_KEY = "jev-test-key";
  process.env.JEV_PRIMARY = "true";
  process.env.JEV_DUAL_RUN = "true";
  const original = globalThis.fetch;

  globalThis.fetch = async () => Response.json(apiPayload("hold", 0.84));
  try {
    const held = await decisionOf({
      amountCents: 24000,
      truckId: "truck-3",
      category: "parts",
      memo: "Clear a $240 parts order for truck 3",
    });
    assert.equal(held.decision, "needs_review");
    assert.equal(held.jev?.applied, true);
    assert.equal(held.jev?.shopDecision, "approve");
    assert.equal(held.jev?.jevDecision, "needs_review");
    assert.equal(held.jev?.matchesShop, false);
    assert.equal(held.jev?.dualRun, true);
    assert.match(held.reason, /decision aid/i);
    assert.ok(held.ruleIds.includes("JEV-HOLD"));
  } finally {
    globalThis.fetch = original;
  }

  globalThis.fetch = async () => Response.json(apiPayload("approve", 0.99));
  try {
    const denied = await decisionOf({
      amountCents: 240000,
      truckId: "truck-3",
      category: "parts",
      memo: "Clear a $2,400 compressor for truck 3",
    });
    assert.equal(denied.decision, "deny");
    assert.equal(denied.jev?.hardRuleBlocked, true);
    assert.equal(denied.jev?.applied, false);
    assert.match(denied.reason, /auto-clear|cap/i);

    const mismatch = await decisionOf({
      amountCents: 8000,
      truckId: "truck-3",
      category: "parts",
      tradeHint: "hvac",
      memo: "Clear $80 of HVAC parts for truck 3",
    });
    assert.equal(mismatch.decision, "needs_review");
    assert.equal(mismatch.jev?.shopDecision, "needs_review");
    assert.equal(mismatch.jev?.applied, false);
  } finally {
    globalThis.fetch = original;
    clearJevEnv();
  }
});

test("dual-run records both decisions and leaves the shop rule in place", async () => {
  clearJevEnv();
  process.env.JEV_API_KEY = "jev-test-key";
  process.env.JEV_DUAL_RUN = "true";
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { state: { memo: string } };
    seen.push(body.state.memo);
    assert.equal(JSON.stringify(body).includes("Mercer"), false);
    return Response.json(apiPayload("hold", 0.77));
  };
  try {
    const result = await decisionOf({
      amountCents: 24000,
      truckId: "truck-3",
      category: "parts",
      memo: "Clear a $240 parts order for truck 3",
    });
    assert.deepEqual(seen, ["Clear a $240 parts order for truck 3"]);
    assert.equal(result.decision, "approve");
    assert.equal(result.jev?.source, "api");
    assert.equal(result.jev?.choice, "hold");
    assert.equal(result.jev?.applied, false);
    assert.equal(result.jev?.shopDecision, "approve");
    assert.equal(result.jev?.jevDecision, "needs_review");
    assert.equal(result.jev?.matchesShop, false);
    assert.equal(result.jev?.dualRun, true);
  } finally {
    globalThis.fetch = original;
    clearJevEnv();
  }
});

async function decisionOf(args: Record<string, unknown>): Promise<PolicyResult> {
  const result = await checkPolicy(args);
  assert.equal(result.isError, false);
  assert.match(result.content[0]?.text ?? "", /Decision aid/);
  return result.structuredContent as PolicyResult;
}
