import { parseAmountCents } from "../data/money";
import { jobs, matchCustomer, trucks, type Job } from "../data/seed";
import type { SpendCategory, Trade } from "../types";

export type Intent =
  | {
      kind: "spend";
      amountCents: number | null;
      truckId: string | null;
      category: SpendCategory;
      tradeHint?: Trade;
      customerName: string | null;
      memo: string;
    }
  | {
      kind: "lookup";
      truckId: string | null;
      customerName: string | null;
      when: "today" | "tomorrow" | "open";
    }
  | {
      kind: "sms";
      truckId: string | null;
      customerName: string | null;
      when: "today" | "tomorrow" | "open";
    }
  | { kind: "unknown" };

const truckWords: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
};

export function parseIntent(utterance: string): Intent {
  const text = utterance.toLowerCase().replace(/[’]/g, "'");
  const amountCents = parseAmountCents(text);
  const customer = matchCustomer(text);
  const truckId = truckFromText(text) ?? truckFromCustomer(customer?.id);
  const when = whenFromText(text);

  const smsCue =
    /\b(sms|text message|a text|the text|customer text)\b/.test(text) &&
    /\b(draft|write|confirm|send|compose)\b/.test(text);
  const lookupCue =
    /\b(pending|status|schedule|open jobs?)\b/.test(text) ||
    /what(?:'s| is|s) (?:pending|open|on the board)/.test(text);
  const spendCue =
    /\b(clear|approve|purchase|buy)\b/.test(text) ||
    (/\border\b/.test(text) && amountCents != null);

  if (smsCue && !spendCue) {
    return {
      kind: "sms",
      truckId: truckFromText(text),
      customerName: customer?.name ?? null,
      when: /\btomorrow\b/.test(text) ? "tomorrow" : /\btoday\b/.test(text) ? "today" : "open",
    };
  }

  if (spendCue) {
    const scrubbed = customer
      ? text.replace(customer.name.toLowerCase(), " ")
      : text;
    return {
      kind: "spend",
      amountCents,
      truckId,
      category: categoryFromText(scrubbed),
      tradeHint: tradeFromText(scrubbed),
      customerName: customer?.name ?? null,
      memo: utterance.slice(0, 180),
    };
  }

  if (lookupCue) {
    return {
      kind: "lookup",
      truckId: truckFromText(text),
      customerName: customer?.name ?? null,
      when,
    };
  }

  return { kind: "unknown" };
}

function truckFromText(text: string): string | null {
  const digit = text.match(/\btruck\s*#?\s*(\d+)\b/);
  if (digit) return truckId(Number(digit[1]));
  const word = text.match(/\btruck\s+(one|two|three|four)\b/);
  if (word) return truckId(truckWords[word[1]]);
  return null;
}

function truckId(number: number): string | null {
  return trucks.find((truck) => truck.number === number)?.id ?? `truck-${number}`;
}

function truckFromCustomer(customerId: string | undefined): string | null {
  if (!customerId) return null;
  const open: Job[] = jobs.filter((job) => job.customerId === customerId);
  if (open.length === 1) return open[0].truckId;
  return null;
}

function whenFromText(text: string): "today" | "tomorrow" | "open" {
  if (/\btomorrow\b/.test(text)) return "tomorrow";
  if (/\btoday\b/.test(text)) return "today";
  return "open";
}

function categoryFromText(text: string): SpendCategory {
  if (/\b(fuel|diesel|gas)\b/.test(text)) return "fuel";
  if (/\b(tools?|meter|drill)\b/.test(text)) return "tools";
  if (/\b(parts?|fittings?|tank|compressor|filter|order)\b/.test(text)) return "parts";
  return "other";
}

function tradeFromText(text: string): Trade | undefined {
  if (/\belectrical\b|\belectric\b/.test(text)) return "electrical";
  if (/\bplumb/.test(text)) return "plumbing";
  if (/\bhvac\b|\bcompressor\b|\bcondenser\b/.test(text)) return "hvac";
  return undefined;
}
