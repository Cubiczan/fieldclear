import { tomorrowLabel } from "../data/clock";
import { shop } from "../data/seed";
import { nid } from "../ids";
import { textResult, type JsonSchema, type McpToolResult } from "../mcp/types";
import type { JobView, SmsResult } from "../types";
import { lookupJobs } from "./jobs";

const drafts = new Map<string, SmsResult>();

const schema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    customer: {
      type: "string",
      description: "Customer to confirm, if the utterance names one.",
    },
    truckId: {
      type: "string",
      description: "Truck id if the install is identified by truck.",
    },
    jobId: {
      type: "string",
      description: "Job id from jobs.lookup, when already known.",
    },
    when: {
      type: "string",
      enum: ["today", "tomorrow", "open"],
      description: "Window to match. Defaults to the soonest single install.",
    },
  },
};

export function getDraft(id: string): SmsResult | undefined {
  return drafts.get(id);
}

/** Draft only. This tool never sends, queues, or contacts a carrier. */
export function draftSms(args: Record<string, unknown>): McpToolResult {
  const lookup = lookupJobs({
    customer: args.customer,
    truckId: args.truckId,
    jobId: args.jobId,
    when: args.when ?? "open",
  });
  if (lookup.isError) return lookup;
  const jobs = (lookup.structuredContent as { jobs: JobView[] }).jobs;
  const chosen = chooseJob(jobs);
  if (!chosen) {
    const names = jobs.map((job) => job.customerName).join(", ");
    const why =
      jobs.length === 0
        ? "I couldn't find an install to confirm. Name the customer or the truck."
        : `Which install? I found ${jobs.length}: ${names}.`;
    return textResult(why, { jobs }, true);
  }

  const day =
    chosen.when === "tomorrow"
      ? `tomorrow, ${tomorrowLabel()}`
      : `today, ${new Intl.DateTimeFormat("en-US", {
          timeZone: shop.timezone,
          weekday: "long",
          month: "long",
          day: "numeric",
        }).format(new Date())}`;
  const window = chosen.windowLabel.replace("–", " and ");
  const body = `Hi ${firstName(chosen.contactName)}, this is ${shop.dispatcherShort} at ${shop.name}. Confirming your ${chosen.title.toLowerCase()} ${day}, between ${window}. ${chosen.techName} will be on truck ${chosen.truckNumber} at ${chosen.address}. Reply YES if that window still works.`;

  const draft: SmsResult = {
    id: nid("sms"),
    jobId: chosen.id,
    customerName: chosen.customerName,
    toName: chosen.contactName,
    toPhone: chosen.contactPhone,
    body,
    sent: false,
  };
  drafts.set(draft.id, draft);
  return textResult(
    `Draft to ${draft.toName} · ${draft.toPhone} · not sent`,
    draft,
  );
}

function chooseJob(jobs: JobView[]): JobView | null {
  if (jobs.length === 1) return jobs[0];
  const tomorrow = jobs.filter((job) => job.when === "tomorrow");
  if (tomorrow.length === 1) return tomorrow[0];
  return null;
}

function firstName(name: string): string {
  return name.split(" ")[0] || name;
}

export const smsTool = {
  name: "sms.draft",
  description:
    "Draft an outbound customer SMS from a job on the board. Always returns sent:false. Does not call a carrier.",
  inputSchema: schema,
  call: draftSms,
};
