import type { PlannerStatus } from "../types";

export function plannerStatus(): PlannerStatus {
  if (process.env.USE_BEDROCK === "true") {
    return {
      kind: "bedrock",
      note: "USE_BEDROCK=true. Each step asks Amazon Bedrock Converse which tool to run. The tools still execute on this machine.",
    };
  }
  return {
    kind: "heuristic",
    note: "Local heuristic planner. It reads the utterance and runs the tool checklist. Set USE_BEDROCK=true to use Amazon Bedrock Converse.",
  };
}
