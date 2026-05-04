import type { OpenAIToolSchema } from "../llm/types";

export type McpServerRow = {
    id: string;
    user_id: string;
    slug: string;
    name: string;
    url: string;
    headers: Record<string, string>;
    enabled: boolean;
    last_error: string | null;
};

/**
 * One MCP server, opened for the duration of a single chat request.
 *
 * `tools` are already prefixed (`mcp__<slug>__<toolName>`) and ready to merge
 * into the per-request tool list. The original tool name is preserved in
 * `toolNameMap` so the dispatcher can call back into the MCP server with the
 * unprefixed name.
 */
export type LoadedMcpServer = {
    row: McpServerRow;
    tools: OpenAIToolSchema[];
    /** prefixed tool name → original MCP tool name */
    toolNameMap: Map<string, string>;
    client: {
        callTool: (
            toolName: string,
            args: Record<string, unknown>,
        ) => Promise<string>;
        close: () => Promise<void>;
    };
};
