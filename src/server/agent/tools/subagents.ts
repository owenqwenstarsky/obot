import { z } from "zod";
import type { TaskInfo, ToolScope } from "@/server/agent/tools/types";
import { defineTool } from "@/server/agent/tools/types";

const available = (s: ToolScope) => s.threadKind === "CHAT" && s.flags.subagentsEnabled && s.flags.subagentModelCount > 0;

function describe(t: TaskInfo, withResult: boolean) {
  const head = `- ${t.taskId} "${t.title}" [${t.status.toLowerCase()}] model=${t.modelId}`;
  if (!withResult || t.status === "RUNNING") return head;
  const body = t.status === "COMPLETED" ? (t.result ?? "(no final message)") : [t.error && `error: ${t.error}`, t.result].filter(Boolean).join("\n");
  return `${head}\n${body}`;
}

export const subagentCapabilitiesTool = defineTool({
  name: "subagent_capabilities",
  description:
    "List the models you may run sub-agents on (with descriptions and reasoning efforts), the concurrency limit, how many are running, and the tools sub-agents get. Call once before your first delegate_task in a turn.",
  schema: z.object({}),
  available,
  execute: async (_a, ctx) => {
    if (!ctx.services.tasks) return { output: "Error: sub-agents are not available.", isError: true };
    const caps = await ctx.services.tasks.capabilities();
    return { output: JSON.stringify(caps, null, 2), display: { kind: "json", value: caps } };
  },
});

export const delegateTaskTool = defineTool({
  name: "delegate_task",
  description:
    "Start a sub-agent on a self-contained task in its own thread. Returns immediately with a task id; the sub-agent runs in the background. " +
    "The brief is the sub-agent's ONLY context: state the goal, relevant facts, what's already ruled out, the exact deliverable, and keep the scope narrow. " +
    "You are notified automatically when it finishes (do not poll). Its final message is returned to you.",
  schema: z.object({
    title: z.string().min(1).max(120).describe("Short label shown to the user, e.g. 'Compare hosting prices'."),
    prompt: z.string().min(1).max(100_000).describe("The full brief for the sub-agent."),
    model: z.string().optional().describe("Model id from subagent_capabilities. Defaults to yours if allowed, else the first allowed model."),
    effort: z.string().optional().describe("Reasoning effort supported by that model."),
  }),
  available,
  concurrency: "serial",
  execute: async (a, ctx) => {
    const args = a as { title: string; prompt: string; model?: string; effort?: string };
    if (!ctx.services.tasks) return { output: "Error: sub-agents are not available.", isError: true };
    const t = await ctx.services.tasks.delegate({ ...args, callId: ctx.callId });
    return {
      output:
        `Started task ${t.taskId} ("${t.title}") on ${t.modelId}. It runs in the background and you'll get a notification when it finishes. ` +
        "Don't poll or redo its work. Continue with other work, or end your turn; the runtime keeps waiting for running sub-agents automatically.",
      display: { kind: "subagent", taskId: t.taskId, childThreadId: t.childThreadId, title: t.title, modelId: t.modelId, status: t.status },
    };
  },
});

export const waitTasksTool = defineTool({
  name: "wait_tasks",
  description:
    "Block until at least one of the given sub-agent tasks finishes (or the user sends a message, or the timeout passes) and return their statuses and any new results. Optional: the runtime already waits automatically when you end your turn with tasks running.",
  schema: z.object({
    task_ids: z.array(z.string()).min(1).max(16),
    timeout_s: z.number().int().min(1).max(1800).optional().describe("Default 600."),
  }),
  available,
  timeoutMs: 1_850_000,
  execute: async (a, ctx) => {
    const args = a as { task_ids: string[]; timeout_s?: number };
    if (!ctx.services.tasks) return { output: "Error: sub-agents are not available.", isError: true };
    const res = await ctx.services.tasks.waitAny(args.task_ids, {
      timeoutMs: (args.timeout_s ?? 600) * 1000,
      signal: ctx.signal,
      onSteer: (cb) => ctx.services.steering.onEnqueue(cb),
    });
    const why =
      res.reason === "settled"
        ? "A task finished."
        : res.reason === "steer"
          ? "Stopped waiting: the user sent a message."
          : res.reason === "interrupted"
            ? "Stopped waiting: interrupted by the user."
            : "Timed out; tasks are still running.";
    return { output: `${why}\n${res.tasks.map((t) => describe(t, true)).join("\n")}` };
  },
});

export const taskStatusTool = defineTool({
  name: "task_status",
  description: "Get the status (and results of finished tasks) for sub-agent tasks started in this turn. Omit task_ids for all.",
  schema: z.object({ task_ids: z.array(z.string()).max(32).optional() }),
  available,
  execute: async (a, ctx) => {
    const args = a as { task_ids?: string[] };
    if (!ctx.services.tasks) return { output: "Error: sub-agents are not available.", isError: true };
    const list = await ctx.services.tasks.status(args.task_ids);
    return { output: list.length ? list.map((t) => describe(t, true)).join("\n") : "No sub-agent tasks in this turn." };
  },
});

export const taskCancelTool = defineTool({
  name: "task_cancel",
  description: "Cancel a running sub-agent task you no longer need.",
  schema: z.object({ task_id: z.string().min(1) }),
  available,
  execute: async (a, ctx) => {
    const args = a as { task_id: string };
    if (!ctx.services.tasks) return { output: "Error: sub-agents are not available.", isError: true };
    const t = await ctx.services.tasks.cancel(args.task_id);
    return { output: `Task ${t.taskId} is ${t.status.toLowerCase()}.` };
  },
});

export const subagentTools = [subagentCapabilitiesTool, delegateTaskTool, waitTasksTool, taskStatusTool, taskCancelTool];
