import { ToolRegistry } from "@/server/agent/tools/registry";
import type { ToolDefinition } from "@/server/agent/tools/types";

/** Every local tool the agent can be given. Each run gets the subset its scope allows. */
const ALL_TOOLS: ToolDefinition[] = [];

export const toolRegistry = new ToolRegistry(ALL_TOOLS);
