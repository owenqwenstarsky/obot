import { z } from "zod";
import { defineTool } from "@/server/agent/tools/types";

export const rememberTool = defineTool({
  name: "remember",
  description:
    "Save a short, durable fact about the user to long-term memory so you can use it in future conversations (e.g. their role, ongoing projects, or a stated preference). " +
    "Use it when the user asks you to remember something, or when they share a lasting preference they'd clearly want kept. Never store secrets or passwords.",
  schema: z.object({
    content: z.string().min(1).max(1000).describe("The fact, written as a self-contained sentence about the user."),
  }),
  available: (s) => s.threadKind === "CHAT" && s.flags.memoryEnabled,
  concurrency: "serial",
  execute: async (args, ctx) => {
    const { content } = args as { content: string };
    const memories = ctx.services.memories;
    if (!memories) return { output: "Error: memory is not available.", isError: true };
    try {
      const m = await memories.add(content);
      return {
        output: `Saved to memory as [${m.id}]: ${m.content}`,
        display: { kind: "memory", action: "saved", memoryId: m.id, content: m.content },
      };
    } catch (err) {
      return { output: `Error: ${(err as Error).message}`, isError: true };
    }
  },
});

export const forgetTool = defineTool({
  name: "forget",
  description: "Delete a saved memory by its id (shown in brackets in your Memory section), e.g. when the user asks you to forget it or it's no longer true.",
  schema: z.object({ id: z.string().min(1).max(64).describe("The memory id.") }),
  available: (s) => s.threadKind === "CHAT" && s.flags.memoryEnabled,
  concurrency: "serial",
  execute: async (args, ctx) => {
    const { id } = args as { id: string };
    const memories = ctx.services.memories;
    if (!memories) return { output: "Error: memory is not available.", isError: true };
    const removed = await memories.remove(id);
    if (!removed) return { output: `Error: no memory with id ${id}.`, isError: true };
    return {
      output: `Forgot [${id}]: ${removed.content}`,
      display: { kind: "memory", action: "forgotten", memoryId: id, content: removed.content },
    };
  },
});

export const memoryTools = [rememberTool, forgetTool];
