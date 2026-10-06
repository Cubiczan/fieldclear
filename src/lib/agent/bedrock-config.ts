/**
 * Amazon Nova Lite on Bedrock is the production planner.
 * Anthropic / Claude model ids are refused. Marketplace Claude is not used.
 */

export const DEFAULT_BEDROCK_MODEL_ID = "us.amazon.nova-lite-v1:0";
export const NOVA_LITE_FOUNDATION_MODEL_ID = "amazon.nova-lite-v1:0";
export const DEFAULT_AWS_REGION = "us-east-1";

export type BedrockAuth = "oidc" | "chain";

export type BedrockPlan =
  | {
      kind: "bedrock";
      modelId: string;
      region: string;
      auth: BedrockAuth;
      note: string;
    }
  | { kind: "heuristic"; note: string };

/** True when this process should ask Bedrock to choose tools. */
export function bedrockEnabled(): boolean {
  const flag = process.env.USE_BEDROCK?.trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off") return false;
  if (flag === "true" || flag === "1" || flag === "on") return true;
  return process.env.NODE_ENV === "production";
}

export function bedrockRegion(): string {
  return process.env.AWS_REGION?.trim() || DEFAULT_AWS_REGION;
}

/**
 * Inference profile by default. `amazon.nova-lite-v1:0` is the other accepted id.
 * Any anthropic or claude id is refused before a request is built.
 */
export function bedrockModelId(): string {
  const configured = process.env.BEDROCK_MODEL_ID?.trim();
  const id = configured || DEFAULT_BEDROCK_MODEL_ID;
  const lower = id.toLowerCase();
  if (lower.includes("anthropic") || lower.includes("claude")) {
    throw new Error(
      `Refusing BEDROCK_MODEL_ID "${id}". FieldClear uses Amazon Nova Lite (${DEFAULT_BEDROCK_MODEL_ID}).`,
    );
  }
  return id;
}

/**
 * On Vercel, Nova is called with OIDC role assumption when AWS_ROLE_ARN is set.
 * A long-lived access key still works through the default chain, but is not the path to use.
 * With neither, production stays on the local planner instead of waiting on IMDS.
 */
export function bedrockAuthMode(): BedrockAuth | "missing" {
  const roleArn = process.env.AWS_ROLE_ARN?.trim();
  if (process.env.VERCEL === "1") {
    if (roleArn) return "oidc";
    if (process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim()) {
      return "chain";
    }
    return "missing";
  }
  return "chain";
}

export function bedrockPlan(): BedrockPlan {
  if (!bedrockEnabled()) {
    return {
      kind: "heuristic",
      note: "Local heuristic planner. It reads the utterance and runs the tool checklist. Production uses Amazon Nova Lite on Bedrock unless USE_BEDROCK=false.",
    };
  }

  let modelId: string;
  try {
    modelId = bedrockModelId();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model id refused.";
    return { kind: "heuristic", note: `${message} The local planner is running.` };
  }

  const auth = bedrockAuthMode();
  if (auth === "missing") {
    return {
      kind: "heuristic",
      note: "Amazon Nova Lite is the Bedrock model for this deployment. AWS_ROLE_ARN is not set, so the local planner is running. On Vercel, assume an IAM role with OIDC instead of storing access keys.",
    };
  }

  const via = auth === "oidc" ? "Vercel OIDC" : "the AWS credential chain";
  return {
    kind: "bedrock",
    modelId,
    region: bedrockRegion(),
    auth,
    note: `Amazon Nova Lite (${modelId}) on Bedrock Converse is choosing tools via ${via}. The tools still execute on this machine.`,
  };
}
