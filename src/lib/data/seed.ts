import type { SpendCategory, Trade } from "../types";

export const shop = {
  name: "Northline Mechanical",
  city: "Providence, RI",
  dispatcher: "Sam Okonkwo",
  dispatcherShort: "Sam",
  timezone: "America/New_York",
} as const;

export const POLICY = {
  version: "2026.10",
  uri: "fieldclear://policy/northline",
  dailyTruckCapCents: 80_000,
  tickets: {
    parts: 50_000,
    fuel: 15_000,
    tools: 30_000,
    other: 10_000,
  } satisfies Record<SpendCategory, number>,
  rules: [
    {
      id: "POL-TICKET",
      summary: "Parts auto-clear at $500, fuel at $150, tools at $300, anything else at $100.",
    },
    {
      id: "POL-DAILY",
      summary: "Each truck can clear at most $800 in a shop day.",
    },
    {
      id: "POL-OPEN-JOB",
      summary: "Spend has to sit on an open job. An idle truck cannot clear a ticket.",
    },
    {
      id: "POL-TRADE",
      summary: "A trade mismatch (HVAC parts on a plumbing job) waits for the office.",
    },
    {
      id: "POL-TRUCK",
      summary: "The truck number has to exist on the board.",
    },
  ],
} as const;

export type Customer = {
  id: string;
  name: string;
  kind: "commercial" | "residential";
};

export type Truck = {
  id: string;
  number: number;
  trade: Trade;
  techName: string;
  status: "on_job" | "idle";
};

export type JobBlocker = {
  id: string;
  kind: "parts" | "sms";
  label: string;
};

export type Job = {
  id: string;
  customerId: string;
  truckId: string;
  trade: Trade;
  title: string;
  status: "scheduled" | "in_progress" | "waiting_parts";
  when: "today" | "tomorrow";
  windowLabel: string;
  address: string;
  contactName: string;
  contactPhone: string;
  notes: string[];
  blockers: JobBlocker[];
};

export const customers: Customer[] = [
  { id: "cust-acme", name: "Acme Plumbing", kind: "commercial" },
  { id: "cust-harbor", name: "Harborview Dental", kind: "commercial" },
  { id: "cust-oak", name: "Oak Street Apartments", kind: "commercial" },
];

export const trucks: Truck[] = [
  { id: "truck-1", number: 1, trade: "hvac", techName: "Diego Alvarez", status: "on_job" },
  { id: "truck-2", number: 2, trade: "electrical", techName: "Priya Shah", status: "on_job" },
  { id: "truck-3", number: 3, trade: "plumbing", techName: "Luis Ortega", status: "on_job" },
  { id: "truck-4", number: 4, trade: "hvac", techName: "Andre Cole", status: "idle" },
];

export const jobs: Job[] = [
  {
    id: "job-1042",
    customerId: "cust-acme",
    truckId: "truck-3",
    trade: "plumbing",
    title: "Water heater install",
    status: "waiting_parts",
    when: "tomorrow",
    windowLabel: "9:00–11:00",
    address: "410 Mercer Avenue, Bay 2",
    contactName: "Jordan Hale",
    contactPhone: "(401) 555-2281",
    notes: ["Certificate of insurance is already on file."],
    blockers: [
      {
        id: "parts-240",
        kind: "parts",
        label: "the $240 parts order (expansion tank and fittings) is not cleared",
      },
      {
        id: "sms-confirm",
        kind: "sms",
        label: "the confirmation text has not been drafted",
      },
    ],
  },
  {
    id: "job-1038",
    customerId: "cust-harbor",
    truckId: "truck-1",
    trade: "hvac",
    title: "Condenser swap",
    status: "in_progress",
    when: "today",
    windowLabel: "1:00–4:00",
    address: "88 King Street",
    contactName: "Dr. Elena Cho",
    contactPhone: "(401) 555-7740",
    notes: ["Filter kit is already staged on the truck."],
    blockers: [],
  },
  {
    id: "job-1040",
    customerId: "cust-oak",
    truckId: "truck-2",
    trade: "electrical",
    title: "Panel upgrade, building C",
    status: "in_progress",
    when: "today",
    windowLabel: "8:00–3:00",
    address: "220 Oak Street",
    contactName: "Malik Brooks",
    contactPhone: "(401) 555-0904",
    notes: ["Inspection slot is Thursday morning."],
    blockers: [],
  },
];

export function tradeLabel(trade: Trade): string {
  if (trade === "hvac") return "HVAC";
  if (trade === "plumbing") return "Plumbing";
  return "Electrical";
}

export function customerById(id: string): Customer | undefined {
  return customers.find((customer) => customer.id === id);
}

export function truckById(id: string): Truck | undefined {
  return trucks.find((truck) => truck.id === id);
}

export function jobById(id: string): Job | undefined {
  return jobs.find((job) => job.id === id);
}

export function matchCustomer(text: string): Customer | undefined {
  const normalized = text.toLowerCase();
  const byLength = [...customers].sort((a, b) => b.name.length - a.name.length);
  const direct = byLength.find((customer) =>
    normalized.includes(customer.name.toLowerCase()),
  );
  if (direct) return direct;
  if (/\bacme\b/.test(normalized)) {
    return customers.find((customer) => customer.id === "cust-acme");
  }
  if (/\bharborview\b|\bdental\b/.test(normalized)) {
    return customers.find((customer) => customer.id === "cust-harbor");
  }
  if (/\boak street\b/.test(normalized)) {
    return customers.find((customer) => customer.id === "cust-oak");
  }
  return undefined;
}

export function categoryLimit(category: SpendCategory): number {
  return POLICY.tickets[category];
}
