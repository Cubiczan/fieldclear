export const demoPrompts = [
  {
    name: "clear-parts",
    title: "Clear parts",
    description: "Approve a parts ticket against policy and write the audit log.",
    utterance: "Clear a $240 parts order for truck 3",
  },
  {
    name: "pending-customer",
    title: "Check pending",
    description: "Look up open jobs and blockers for a customer.",
    utterance: "What's pending for Acme Plumbing?",
  },
  {
    name: "draft-sms",
    title: "Draft a text",
    description: "Draft a confirmation SMS. The tool never sends it.",
    utterance: "Draft a customer SMS confirming tomorrow's install",
  },
  {
    name: "deny-over-cap",
    title: "Show a denial",
    description: "A compressor ticket over the parts limit and the daily truck cap.",
    utterance: "Clear a $2,400 compressor for truck 3",
  },
] as const;

export type DemoPrompt = (typeof demoPrompts)[number];
