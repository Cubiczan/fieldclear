/**
 * In-process MCP server surface for the FieldClear Alexa+ simulator.
 *
 * listTools()     ≈ MCP tools/list
 * callTool()      ≈ MCP tools/call
 * listPrompts()   ≈ MCP prompts/list
 * listResources() ≈ MCP resources/list
 *
 * There is no socket transport. `runAgentLoop` in `src/lib/agent/loop.ts` is the host.
 */

import { POLICY } from "../data/seed";
import { jobsTool } from "../tools/jobs";
import { ledgerTool } from "../tools/ledger";
import { policyTool } from "../tools/policy";
import { smsTool } from "../tools/sms";
import { demoPrompts } from "./prompts";
import {
  textResult,
  type McpPrompt,
  type McpResource,
  type McpToolDefinition,
  type McpToolResult,
} from "./types";

type RegisteredTool = McpToolDefinition & {
  call: (args: Record<string, unknown>) => McpToolResult | Promise<McpToolResult>;
};

const catalog: RegisteredTool[] = [policyTool, ledgerTool, jobsTool, smsTool];

export function listTools(): McpToolDefinition[] {
  return catalog.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const tool = catalog.find((item) => item.name === name);
  if (!tool) {
    return textResult(`Unknown tool "${name}".`, null, true);
  }
  return await tool.call(args);
}

export function listPrompts(): McpPrompt[] {
  return demoPrompts.map((prompt) => ({
    name: prompt.name,
    description: `${prompt.description} Utterance: ${prompt.utterance}`,
  }));
}

export function listResources(): McpResource[] {
  return [
    {
      uri: POLICY.uri,
      name: "Northline spend policy",
      description: POLICY.rules.map((rule) => `${rule.id}: ${rule.summary}`).join(" "),
      mimeType: "application/json",
    },
  ];
}
