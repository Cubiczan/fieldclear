export type JsonSchema = {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description?: string;
      enum?: readonly string[];
    }
  >;
  required?: string[];
  additionalProperties?: boolean;
};

/** Shape returned by tools/list. */
export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

/** Shape returned by tools/call. `content` is the MCP content array. */
export type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: unknown;
  isError: boolean;
};

export type McpPrompt = {
  name: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
};

export type McpResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
};

export function textResult(
  text: string,
  structuredContent: unknown,
  isError = false,
): McpToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent,
    isError,
  };
}
