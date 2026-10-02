import type { JevRuntimeMode, PlannerStatus } from "../types";

export function plannerStatus(): PlannerStatus {
  const jev = jevRuntimeMode();
  if (process.env.USE_BEDROCK === "true") {
    return {
      kind: "bedrock",
      note: "USE_BEDROCK=true. Each step asks Amazon Bedrock Converse which tool to run. The tools still execute on this machine.",
      jev,
    };
  }
  return {
    kind: "heuristic",
    note: "Local heuristic planner. It reads the utterance and runs the tool checklist. Set USE_BEDROCK=true to use Amazon Bedrock Converse.",
    jev,
  };
}

/** How policy.check is consulting Jev for this process. The key itself is never returned. */
export function jevRuntimeMode(): JevRuntimeMode {
  const key = Boolean(process.env.JEV_API_KEY?.trim());
  const primary = process.env.JEV_PRIMARY === "true";
  const dualRun = process.env.JEV_DUAL_RUN === "true";
  const dual = dualRun ? " Dual-run records the shop rule and the Jev score together." : "";

  if (primary) {
    return {
      mode: "primary",
      label: key ? "Jev primary" : "Jev primary · local",
      note: key
        ? `JEV_PRIMARY=true. Jev can hold or deny a ticket the shop rules would clear. A hard shop deny stays a deny. Decision aid only.${dual}`
        : `JEV_PRIMARY=true without JEV_API_KEY. The local fallback can hold or deny a ticket the shop rules would clear. A hard shop deny stays a deny. Decision aid only.${dual}`,
    };
  }
  if (key) {
    return {
      mode: "advisory",
      label: dualRun ? "Jev advisory · dual-run" : "Jev advisory",
      note: `Jev scores each policy.check. Shop rules still decide. Decision aid only.${dual}`,
    };
  }
  return {
    mode: "fallback",
    label: dualRun ? "Jev fallback · dual-run" : "Jev fallback",
    note: `No JEV_API_KEY. policy.check uses a deterministic local fallback for the Jev score. Shop rules still decide. Decision aid only.${dual}`,
  };
}
