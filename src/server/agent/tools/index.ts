import { ToolRegistry } from "@/server/agent/tools/registry";
import type { ToolDefinition } from "@/server/agent/tools/types";
import { sandboxTools } from "@/server/agent/tools/sandbox";
import { artifactTools } from "@/server/agent/tools/artifacts";

/** Every local tool the agent can be given. Each run gets the subset its scope allows. */
const ALL_TOOLS: ToolDefinition[] = [...sandboxTools, ...artifactTools];

export const toolRegistry = new ToolRegistry(ALL_TOOLS);
