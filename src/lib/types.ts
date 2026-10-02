export type Trade = "hvac" | "plumbing" | "electrical";

export type SpendCategory = "parts" | "fuel" | "tools" | "other";

export type PolicyDecisionName = "approve" | "deny" | "needs_review";

export type PlannerKind = "heuristic" | "bedrock";

export type ToolName =
  | "policy.check"
  | "ledger.append"
  | "jobs.lookup"
  | "sms.draft";

export type JevChoiceName = "approve" | "hold" | "deny";

/** Calibrated Jev signal attached to a policy decision. A decision aid, not a clearance. */
export type JevGateView = {
  source: "api" | "fallback";
  model: string;
  choice: JevChoiceName;
  confidence: number;
  probabilities: Record<JevChoiceName, number>;
  nouls: {
    withinHardCaps: number;
    tradeMismatch: number;
    notesNeedReview: number;
    slaPressure: number;
  };
  disclaimer: string;
  applied: boolean;
  hardRuleBlocked: boolean;
  primary: boolean;
  dualRun: boolean;
  shopDecision: PolicyDecisionName;
  jevDecision: PolicyDecisionName;
  matchesShop: boolean;
  fallbackReason?: string;
};

export type JevRuntimeMode = {
  mode: "fallback" | "advisory" | "primary";
  label: string;
  note: string;
};

export type PolicyResult = {
  id: string;
  decision: PolicyDecisionName;
  reason: string;
  amountCents: number;
  truckId: string;
  truckLabel: string;
  category: SpendCategory;
  ruleIds: string[];
  jobId?: string;
  jobTitle?: string;
  customerName?: string;
  techName?: string;
  remainingDailyCents?: number;
  memo: string;
  jev?: JevGateView;
};

export type JobView = {
  id: string;
  title: string;
  customerId: string;
  customerName: string;
  truckId: string;
  truckNumber: number;
  truckLabel: string;
  trade: Trade;
  techName: string;
  when: "today" | "tomorrow";
  windowLabel: string;
  address: string;
  contactName: string;
  contactPhone: string;
  status: string;
  pending: string[];
  notes: string[];
};

export type JobsResult = {
  jobs: JobView[];
  summary: string;
};

export type SmsResult = {
  id: string;
  jobId: string;
  customerName: string;
  toName: string;
  toPhone: string;
  body: string;
  sent: false;
};

export type LedgerResult = {
  entryId: string;
  hash: string;
  action: string;
  summary: string;
};

export type ToolStep = {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  summary: string;
  structured: unknown;
  durationMs: number;
};

export type ApprovalCard = {
  decision: PolicyDecisionName;
  reason: string;
  amountCents: number;
  truckLabel: string;
  category: string;
  jobTitle?: string;
  customerName?: string;
  ruleIds: string[];
  jev?: JevGateView;
};

export type DraftCard = {
  toName: string;
  toPhone: string;
  body: string;
  jobId: string;
  customerName: string;
  sent: false;
};

export type AssistantTurn = {
  say: string;
  approval?: ApprovalCard;
  draft?: DraftCard;
};

export type StreamEvent =
  | { type: "meta"; planner: PlannerKind; note: string }
  | { type: "step"; step: ToolStep }
  | { type: "done"; turn: AssistantTurn }
  | { type: "ledger"; audit: AuditSnapshot }
  | { type: "error"; message: string };

export type AuditEntry = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  subject: string;
  summary: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
};

export type AuditSnapshot = {
  entries: AuditEntry[];
  intact: boolean;
  company: string;
};

export type PlannerStatus = {
  kind: PlannerKind;
  note: string;
  jev: JevRuntimeMode;
};
