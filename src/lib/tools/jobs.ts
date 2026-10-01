import {
  customerById,
  jobById,
  jobs,
  truckById,
  type Job,
} from "../data/seed";
import { blockerCleared } from "../data/store";
import { textResult, type JsonSchema, type McpToolResult } from "../mcp/types";
import type { JobView, JobsResult } from "../types";

const schema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    customer: {
      type: "string",
      description: "Customer name, for example Acme Plumbing.",
    },
    truckId: {
      type: "string",
      description: 'Truck id such as "truck-3".',
    },
    when: {
      type: "string",
      enum: ["today", "tomorrow", "open"],
      description: "Which window to include. open means every job still on the board.",
    },
    jobId: {
      type: "string",
      description: "Exact job id when the caller already has one.",
    },
  },
};

export function lookupJobs(args: Record<string, unknown>): McpToolResult {
  const when = args.when ?? "open";
  if (when !== "today" && when !== "tomorrow" && when !== "open") {
    return textResult("when must be today, tomorrow, or open.", null, true);
  }

  let selected: Job[] = jobs.slice();
  if (typeof args.jobId === "string") {
    const job = jobById(args.jobId);
    selected = job ? [job] : [];
  }
  if (typeof args.truckId === "string") {
    selected = selected.filter((job) => job.truckId === args.truckId);
  }
  if (typeof args.customer === "string" && args.customer.trim()) {
    const needle = args.customer.toLowerCase();
    selected = selected.filter((job) => {
      const customer = customerById(job.customerId);
      return customer?.name.toLowerCase().includes(needle) || needle.includes(customer?.name.toLowerCase() ?? "\u0000");
    });
  }
  if (when !== "open") {
    selected = selected.filter((job) => job.when === when);
  }

  const views = selected.map(toView);
  const summary = summarize(views, args);
  const structured: JobsResult = { jobs: views, summary };
  return textResult(summary, structured);
}

function toView(job: Job): JobView {
  const customer = customerById(job.customerId);
  const truck = truckById(job.truckId);
  const pending = job.blockers
    .filter((blocker) => !blockerCleared(job.id, blocker.kind))
    .map((blocker) => blocker.label);
  return {
    id: job.id,
    title: job.title,
    customerId: job.customerId,
    customerName: customer?.name ?? "Unknown customer",
    truckId: job.truckId,
    truckNumber: truck?.number ?? 0,
    truckLabel: truck ? `Truck ${truck.number}` : job.truckId,
    trade: job.trade,
    techName: truck?.techName ?? "Unassigned",
    when: job.when,
    windowLabel: job.windowLabel,
    address: job.address,
    contactName: job.contactName,
    contactPhone: job.contactPhone,
    status: job.status,
    pending,
    notes: job.notes,
  };
}

function summarize(views: JobView[], args: Record<string, unknown>): string {
  if (views.length === 0) {
    if (typeof args.truckId === "string") {
      const truck = truckById(args.truckId);
      if (truck?.status === "idle") {
        return `Truck ${truck.number} is idle. ${truck.techName} doesn't have an open job.`;
      }
      if (truck) return `Nothing open on truck ${truck.number}.`;
    }
    if (typeof args.customer === "string") {
      return `Nothing open for ${args.customer}.`;
    }
    return "Nothing open on the board for that lookup.";
  }
  if (views.length === 1) {
    const job = views[0];
    return `${job.customerName} · ${job.title} · ${job.when} · ${job.truckLabel}`;
  }
  return `${views.length} open jobs · ${views.map((job) => job.customerName).join(", ")}`;
}

export const jobsTool = {
  name: "jobs.lookup",
  description:
    "Read the seeded job board: customer, truck, tech, window, and what is still pending. Pending parts and texts drop off once the audit log shows they were cleared or drafted.",
  inputSchema: schema,
  call: lookupJobs,
};
