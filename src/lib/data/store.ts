import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { nid } from "../ids";
import type { AuditEntry, AuditSnapshot } from "../types";
import { shop } from "./seed";

const ZERO = "0".repeat(64);
const AGENT_ACTOR = "alexa+.fieldclear";

export { AGENT_ACTOR };

const session = new AsyncLocalStorage<{ entries: AuditEntry[] }>();

type EntryBody = Omit<AuditEntry, "prevHash" | "hash">;

function location(): { dir: string; file: string } {
  const dir = process.env.FIELD_DATA_DIR || path.join(process.cwd(), ".data");
  return { dir, file: path.join(dir, "ledger.json") };
}

function canonical(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const next = (value as Record<string, unknown>)[key];
        if (next !== undefined) acc[key] = sortValue(next);
        return acc;
      }, {});
  }
  return value;
}

function hashBody(prevHash: string, body: EntryBody): string {
  return createHash("sha256")
    .update(`${prevHash}\n${canonical(body)}`)
    .digest("hex");
}

function seal(prevHash: string, body: EntryBody): AuditEntry {
  return { ...body, prevHash, hash: hashBody(prevHash, body) };
}

function seedEntries(now = new Date()): AuditEntry[] {
  const opened = seal(ZERO, {
    id: "led_genesis",
    ts: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 12).toISOString(),
    actor: "sam.okonkwo",
    action: "ledger.genesis",
    subject: "northline",
    summary: "Opened the Northline Mechanical audit log.",
    payload: { policy: "fieldclear://policy/northline" },
  });

  const fuel = seal(opened.hash, {
    id: "led_seed_fuel",
    ts: new Date(now.getTime() - 1000 * 60 * 60 * 5).toISOString(),
    actor: "sam.okonkwo",
    action: "spend.approve",
    subject: "truck-1",
    summary: "Approved $86 fuel for truck 1 (Diego Alvarez, condenser swap).",
    payload: {
      truckId: "truck-1",
      amountCents: 8600,
      category: "fuel",
      jobId: "job-1038",
      decision: "approve",
    },
  });

  const denied = seal(fuel.hash, {
    id: "led_seed_tools",
    ts: new Date(now.getTime() - 1000 * 60 * 90).toISOString(),
    actor: "sam.okonkwo",
    action: "spend.deny",
    subject: "truck-4",
    summary:
      "Denied $900 in tools for truck 4. The truck is idle, and tools cap at $300.",
    payload: {
      truckId: "truck-4",
      amountCents: 90000,
      category: "tools",
      decision: "deny",
    },
  });

  return [opened, fuel, denied];
}

function writeEntries(entries: AuditEntry[]): void {
  const { dir, file } = location();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

export function seedAuditSnapshot(now = new Date()): AuditSnapshot {
  const entries = seedEntries(now);
  return {
    entries,
    intact: verifyChain(entries),
    company: shop.name,
  };
}

/** Browser and Vercel turns pass the chain in. Serverless disks are not the log. */
export function parseClientLedger(value: unknown): AuditEntry[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const entries: AuditEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.ts !== "string" ||
      typeof row.actor !== "string" ||
      typeof row.action !== "string" ||
      typeof row.subject !== "string" ||
      typeof row.summary !== "string" ||
      typeof row.prevHash !== "string" ||
      typeof row.hash !== "string" ||
      !row.payload ||
      typeof row.payload !== "object" ||
      Array.isArray(row.payload)
    ) {
      return undefined;
    }
    entries.push({
      id: row.id,
      ts: row.ts,
      actor: row.actor,
      action: row.action,
      subject: row.subject,
      summary: row.summary,
      payload: row.payload as Record<string, unknown>,
      prevHash: row.prevHash,
      hash: row.hash,
    });
  }
  return entries;
}

export async function runWithLedger<T>(
  entries: AuditEntry[],
  fn: () => Promise<T>,
): Promise<T> {
  return session.run({ entries: structuredClone(entries) }, fn);
}

export function sessionAudit(): AuditSnapshot | null {
  const live = session.getStore();
  if (!live) return null;
  return {
    entries: live.entries,
    intact: verifyChain(live.entries),
    company: shop.name,
  };
}

export function readEntries(): AuditEntry[] {
  const live = session.getStore();
  if (live) return live.entries;
  const { file } = location();
  if (!fs.existsSync(file)) {
    const seeded = seedEntries();
    writeEntries(seeded);
    return seeded;
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as AuditEntry[];
  return parsed;
}

export function verifyChain(entries: AuditEntry[]): boolean {
  let expectedPrev = ZERO;
  for (const entry of entries) {
    if (entry.prevHash !== expectedPrev) return false;
    const body: EntryBody = {
      id: entry.id,
      ts: entry.ts,
      actor: entry.actor,
      action: entry.action,
      subject: entry.subject,
      summary: entry.summary,
      payload: entry.payload,
    };
    if (hashBody(entry.prevHash, body) !== entry.hash) return false;
    expectedPrev = entry.hash;
  }
  return entries.length > 0;
}

export function auditSnapshot(): AuditSnapshot {
  const entries = readEntries();
  return {
    entries,
    intact: verifyChain(entries),
    company: shop.name,
  };
}

export function resetDemoLedger(): AuditSnapshot {
  writeEntries(seedEntries());
  return auditSnapshot();
}

export function appendEntry(input: {
  action: string;
  subject: string;
  summary: string;
  payload: Record<string, unknown>;
  actor?: string;
}): AuditEntry {
  const live = session.getStore();
  const entries = live ? live.entries : readEntries();
  const prev = entries.at(-1);
  const entry = seal(prev?.hash ?? ZERO, {
    id: nid("led"),
    ts: new Date().toISOString(),
    actor: input.actor ?? AGENT_ACTOR,
    action: input.action,
    subject: input.subject,
    summary: input.summary,
    payload: input.payload,
  });
  entries.push(entry);
  if (!live) writeEntries(entries);
  return entry;
}

export function dailyApprovedCents(truckId: string, now = new Date()): number {
  const day = shopDateKey(now);
  return readEntries().reduce((sum, entry) => {
    if (entry.action !== "spend.approve") return sum;
    if (entry.payload.truckId !== truckId) return sum;
    if (shopDateKey(new Date(entry.ts)) !== day) return sum;
    const amount = entry.payload.amountCents;
    return sum + (typeof amount === "number" ? amount : 0);
  }, 0);
}

export function blockerCleared(
  jobId: string,
  kind: "parts" | "sms",
): boolean {
  return readEntries().some((entry) => {
    if (entry.payload.jobId !== jobId) return false;
    if (kind === "parts") {
      return entry.action === "spend.approve" && entry.payload.category === "parts";
    }
    return entry.action === "sms.draft";
  });
}

function shopDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
