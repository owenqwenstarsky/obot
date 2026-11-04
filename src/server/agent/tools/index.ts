import { ToolRegistry } from "@/server/agent/tools/registry";
import type { ToolDefinition } from "@/server/agent/tools/types";
import { sandboxTools } from "@/server/agent/tools/sandbox";
import { artifactTools } from "@/server/agent/tools/artifacts";
import { subagentTools } from "@/server/agent/tools/subagents";
import { webTools } from "@/server/agent/tools/web";
import { memoryTools } from "@/server/agent/tools/memory";

/** Every local tool the agent can be given. Each run gets the subset its scope allows. */
const ALL_TOOLS: ToolDefinition[] = [...sandboxTools, ...webTools, ...memoryTools, ...artifactTools, ...subagentTools];

export const toolRegistry = new ToolRegistry(ALL_TOOLS);
