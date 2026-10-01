# Design

The host is `runAgentLoop`. It asks either the heuristic planner or Bedrock Converse for a single next action, then `callTool` runs one of four in-process tools. The spoken line is composed from tool results.

Spend writes go through `policy.check` first. `ledger.append` copies the stored decision and rejects an approve action when the decision was a denial.

The audit file is append-only aside from the demo reset, which replaces the file with the seed. Each entry stores the previous hash and a SHA-256 of the canonical body.

Bedrock is a planner only. It never receives AWS credentials from the repo. The default path does not import the SDK until USE_BEDROCK is true.
