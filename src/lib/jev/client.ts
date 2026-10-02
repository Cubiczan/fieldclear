/**
 * TypeSafe Jev (System One) client for FieldClear policy.check.
 *
 * Text and structured state only. Choice + Noul. No chat and no vision.
 * POST https://thejevai.com/v1/systemone
 *
 * Without JEV_API_KEY, or when the call fails, a deterministic local
 * fallback returns the same shape. Shop hard denies stay outside this module.
 */

import type { PolicyDecisionName, SpendCategory, Trade } from "../types";

export const JEV_ENDPOINT = "https://thejevai.com/v1/systemone";
export const DEFAULT_JEV_MODEL = "jev-1.13.0";
export const JEV_DISCLAIMER =
  "Decision aid only. Jev does not clear spend or send a text. A hard shop deny stays a deny.";

export const JEV_CONFIDENCE_FLOOR = 0.7;
export const JEV_NOUL_HOLD = 0.65;
export const JEV_SLA_HOLD = 0.8;

const REVIEW_PATTERN =
  /\b(dispute|chargeback|do not approve|don't approve|do not clear|hold|change[- ]order|office review|needs review)\b/i;
const URGENT_PATTERN = /\b(urgent|asap|immediately|right now)\b/i;

export type JevChoiceName = "approve" | "hold" | "deny";

export type PolicySignalState = {
  amountCents: number;
  category: SpendCategory;
  categoryLimitCents: number;
  dailyCapCents: number;
  spentTodayCents: number;
  remainingDailyCents: number;
  truck: {
    id: string;
    number: number;
    trade: Trade;
    status: string;
    techName: string;
  } | null;
  job: {
    id: string;
    title: string;
    trade: Trade;
    status: string;
    when: string;
    windowLabel: string;
    notes: string[];
    customerName?: string;
  } | null;
  tradeHint?: Trade;
  memo: string;
  hardRuleIds: string[];
};

export type JevNouls = {
  withinHardCaps: number;
  tradeMismatch: number;
  notesNeedReview: number;
  slaPressure: number;
};

export type JevPolicySignal = {
  source: "api" | "fallback";
  model: string;
  choice: JevChoiceName;
  confidence: number;
  probabilities: Record<JevChoiceName, number>;
  nouls: JevNouls;
  disclaimer: string;
  fallbackReason?: string;
};

export type JevClientOptions = {
  apiKey?: string | null;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
};

export type AppliedJevSignal = {
  decision: PolicyDecisionName;
  jevDecision: PolicyDecisionName;
  applied: boolean;
  hardRuleBlocked: boolean;
};

type ResolvedCall = {
  apiKey: string;
  model: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  retryDelayMs: number;
};

export function fallbackPolicySignal(state: PolicySignalState): JevPolicySignal {
  const notesText = [state.memo, ...(state.job?.notes ?? [])].join("\n");
  const notesNeedReview = REVIEW_PATTERN.test(notesText);
  const tradeMismatch = Boolean(
    state.tradeHint && state.job && state.tradeHint !== state.job.trade,
  );
  const hard = state.hardRuleIds.length > 0 || state.truck == null || state.job == null;
  const urgent = URGENT_PATTERN.test(state.memo);
  const waiting = state.job?.status === "waiting_parts";
  const tomorrow = state.job?.when === "tomorrow";

  let choice: JevChoiceName = "approve";
  let confidence = 0.93;
  let probabilities: Record<JevChoiceName, number> = { approve: 0.93, hold: 0.05, deny: 0.02 };

  if (hard) {
    choice = "deny";
    confidence = 0.97;
    probabilities = { approve: 0.015, hold: 0.015, deny: 0.97 };
  } else if (tradeMismatch) {
    choice = "hold";
    confidence = 0.91;
    probabilities = { approve: 0.045, hold: 0.91, deny: 0.045 };
  } else if (notesNeedReview) {
    choice = "hold";
    confidence = 0.86;
    probabilities = { approve: 0.07, hold: 0.86, deny: 0.07 };
  } else if (urgent) {
    choice = "hold";
    confidence = 0.72;
    probabilities = { approve: 0.14, hold: 0.72, deny: 0.14 };
  }

  return {
    source: "fallback",
    model: "fieldclear-jev-fallback",
    choice,
    confidence,
    probabilities,
    nouls: {
      withinHardCaps: hard ? 0 : 1,
      tradeMismatch: tradeMismatch ? 1 : 0,
      notesNeedReview: notesNeedReview ? 1 : 0,
      slaPressure: urgent ? 0.9 : waiting ? 0.55 : tomorrow ? 0.2 : 0.08,
    },
    disclaimer: JEV_DISCLAIMER,
  };
}

/**
 * Map a Jev signal onto approve / needs_review / deny.
 * A weak Choice escalates. A strong trade, notes, or SLA Noul blocks an approve.
 */
export function proposeJevDecision(signal: JevPolicySignal): PolicyDecisionName {
  let proposed: PolicyDecisionName =
    signal.choice === "approve"
      ? "approve"
      : signal.choice === "deny"
        ? "deny"
        : "needs_review";

  if (
    (proposed === "approve" || proposed === "deny") &&
    signal.confidence < JEV_CONFIDENCE_FLOOR
  ) {
    proposed = "needs_review";
  }
  if (proposed === "approve" && signal.nouls.tradeMismatch >= JEV_NOUL_HOLD) {
    proposed = "needs_review";
  }
  if (proposed === "approve" && signal.nouls.notesNeedReview >= JEV_NOUL_HOLD) {
    proposed = "needs_review";
  }
  if (proposed === "approve" && signal.nouls.slaPressure >= JEV_SLA_HOLD) {
    proposed = "needs_review";
  }
  return proposed;
}

/**
 * Jev may agree with the shop or tighten the gate (clear → hold/deny, hold → deny).
 * It cannot override a hard deny, and it cannot turn a shop hold into a clear.
 */
export function applyJevSignal(
  shop: PolicyDecisionName,
  signal: JevPolicySignal,
  primary: boolean,
): AppliedJevSignal {
  const jevDecision = proposeJevDecision(signal);
  if (shop === "deny") {
    return { decision: "deny", jevDecision, applied: false, hardRuleBlocked: true };
  }
  if (!primary || strictness(jevDecision) < strictness(shop)) {
    return { decision: shop, jevDecision, applied: false, hardRuleBlocked: false };
  }
  return { decision: jevDecision, jevDecision, applied: true, hardRuleBlocked: false };
}

export async function evaluatePolicySignal(
  state: PolicySignalState,
  options?: JevClientOptions,
): Promise<JevPolicySignal> {
  const apiKey = resolveKey(options);
  if (!apiKey) return fallbackPolicySignal(state);

  const call: ResolvedCall = {
    apiKey,
    model: options?.model?.trim() || process.env.JEV_MODEL?.trim() || DEFAULT_JEV_MODEL,
    fetchImpl: options?.fetchImpl ?? fetch,
    timeoutMs: options?.timeoutMs ?? 2500,
    retryDelayMs: options?.retryDelayMs ?? 200,
  };

  try {
    return await callSystemOne(state, call);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Jev request failed";
    return {
      ...fallbackPolicySignal(state),
      fallbackReason: reason.slice(0, 160),
    };
  }
}

function strictness(decision: PolicyDecisionName): number {
  if (decision === "deny") return 2;
  if (decision === "needs_review") return 1;
  return 0;
}

function resolveKey(options?: JevClientOptions): string | undefined {
  if (options && "apiKey" in options) {
    const key = options.apiKey;
    return typeof key === "string" && key.trim() ? key.trim() : undefined;
  }
  const env = process.env.JEV_API_KEY;
  return typeof env === "string" && env.trim() ? env.trim() : undefined;
}

async function callSystemOne(
  state: PolicySignalState,
  call: ResolvedCall,
): Promise<JevPolicySignal> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await postSystemOne(state, call);
    if ((response.status === 429 || response.status === 529) && attempt === 0) {
      lastStatus = response.status;
      await delay(call.retryDelayMs);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Jev HTTP ${response.status}`);
    }
    const payload: unknown = await response.json();
    const parsed = parseSystemOnePayload(payload, call.model);
    if (!parsed) throw new Error("Jev response was missing a usable decision");
    return parsed;
  }
  throw new Error(`Jev HTTP ${lastStatus || 529}`);
}

async function postSystemOne(state: PolicySignalState, call: ResolvedCall): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), call.timeoutMs);
  try {
    return await call.fetchImpl(JEV_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${call.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: call.model,
        state,
        questions: policyQuestions(),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Jev timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function policyQuestions(): Record<string, unknown> {
  return {
    decision: {
      type: "choice",
      instructions:
        "Choose approve, hold, or deny for this field-service spend ticket. approve only when the amount is within the ticket limit and the daily cap, the truck has an open job, and the spend matches that job. hold when the trade does not match, the memo or job notes need the office, the window is under pressure, or the case is ambiguous. deny when a hard shop rule is already broken.",
      criteria: {
        approve:
          "Known truck, open job, amount within categoryLimitCents and remainingDailyCents, trade matches, notes do not require office review.",
        hold: "A person should see it: trade mismatch, review language, SLA pressure, or low certainty.",
        deny: "Unknown truck, no open job, over the ticket limit, or over the daily truck cap.",
      },
    },
    within_hard_caps: {
      type: "noul",
      instructions:
        "Is this ticket inside the category ticket limit and the remaining daily truck cap, on a known truck with an open job? Use hardRuleIds, truck, job, amountCents, categoryLimitCents, and remainingDailyCents.",
      criteria: {
        true: "hardRuleIds is empty, truck and job are present, and the amount fits both caps.",
        false: "Missing truck, missing job, or a hard cap rule is already listed.",
      },
    },
    trade_mismatch: {
      type: "noul",
      instructions: "Does tradeHint name a different trade than the open job's trade?",
      criteria: {
        true: "tradeHint is set and differs from job.trade.",
        false: "No tradeHint, or it matches job.trade.",
      },
    },
    notes_need_review: {
      type: "noul",
      instructions:
        "Do the memo or job notes ask the office to review this spend, or mention a dispute, change order, do-not-approve, or hold?",
      criteria: {
        true: "Explicit review, dispute, change order, or hold language.",
        false: "Ordinary job notes with no review flag.",
      },
    },
    sla_pressure: {
      type: "noul",
      instructions:
        "Is this job under schedule pressure that should make a person look before spend clears? Consider job.status, job.when, and urgent language in the memo.",
      criteria: {
        true: "waiting_parts, or the memo says urgent, asap, or immediately.",
        false: "Routine scheduled work with no rush language.",
      },
    },
  };
}

function parseSystemOnePayload(payload: unknown, requestedModel: string): JevPolicySignal | null {
  const unwrapped = unwrapPayload(payload);
  if (!unwrapped?.answers || typeof unwrapped.answers !== "object") return null;
  const answers = unwrapped.answers as Record<string, unknown>;
  const decision = parseChoice(answers.decision);
  if (!decision) return null;

  const withinHardCaps = readNoul(answers, "within_hard_caps");
  const tradeMismatch = readNoul(answers, "trade_mismatch");
  const notesNeedReview = readNoul(answers, "notes_need_review");
  const slaPressure = readNoul(answers, "sla_pressure");
  if (
    withinHardCaps == null ||
    tradeMismatch == null ||
    notesNeedReview == null ||
    slaPressure == null
  ) {
    return null;
  }

  return {
    source: "api",
    model: unwrapped.model || requestedModel,
    choice: decision.choice,
    confidence: decision.confidence,
    probabilities: decision.probabilities,
    nouls: { withinHardCaps, tradeMismatch, notesNeedReview, slaPressure },
    disclaimer: JEV_DISCLAIMER,
  };
}

function unwrapPayload(payload: unknown): { model?: string; answers?: unknown } | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const nested = root.result;
  const bag =
    nested && typeof nested === "object" ? (nested as Record<string, unknown>) : root;
  const model =
    typeof bag.model === "string"
      ? bag.model
      : typeof root.model === "string"
        ? root.model
        : undefined;
  return { model, answers: bag.answers ?? root.answers };
}

function parseChoice(
  answer: unknown,
): { choice: JevChoiceName; confidence: number; probabilities: Record<JevChoiceName, number> } | null {
  if (!answer || typeof answer !== "object") return null;
  const record = answer as Record<string, unknown>;
  const choice = record.choice;
  if (choice !== "approve" && choice !== "hold" && choice !== "deny") return null;

  const probabilities = readProbabilities(record.probabilities, choice);
  let confidence = Number(record.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    confidence = Math.max(
      probabilities.approve,
      probabilities.hold,
      probabilities.deny,
    );
  }
  return { choice, confidence, probabilities };
}

function readProbabilities(
  raw: unknown,
  choice: JevChoiceName,
): Record<JevChoiceName, number> {
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const approve = Number(record.approve);
    const hold = Number(record.hold);
    const deny = Number(record.deny);
    if ([approve, hold, deny].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      return { approve, hold, deny };
    }
  }
  const top = choice === "approve" ? 0.9 : choice === "hold" ? 0.9 : 0.9;
  const share = (1 - top) / 2;
  return {
    approve: choice === "approve" ? top : share,
    hold: choice === "hold" ? top : share,
    deny: choice === "deny" ? top : share,
  };
}

function readNoul(answers: Record<string, unknown>, key: string): number | null {
  const answer = answers[key];
  if (!answer || typeof answer !== "object") return null;
  const noul = Number((answer as { noul?: unknown }).noul);
  if (!Number.isFinite(noul) || noul < 0 || noul > 1) return null;
  return noul;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
