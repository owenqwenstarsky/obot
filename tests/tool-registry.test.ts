import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry, runToolCall } from "@/server/agent/tools/registry";
import { defineTool, type AgentFlags, type ToolContext } from "@/server/agent/tools/types";

const flags: AgentFlags = {
  sandboxEnabled: true,
  sandboxPythonEnabled: true,
  artifactsEnabled: true,
  inlineUiEnabled: true,
  subagentsEnabled: false,
  subagentMaxConcurrent: 4,
  subagentModelCount: 0,
};

function ctx(signal = new AbortController().signal): ToolContext {
  return {
    userId: "u",
    threadId: "t",
    rootThreadId: "t",
    runId: "r",
    messageId: "m",
    callId: "c",
    partIndex: 0,
    step: 0,
    signal,
    emit: { patch: () => {}, log: () => {} },
    services: { steering: { onEnqueue: () => () => {}, hasPending: () => false } },
  };
}

const chatOnly = defineTool({
  name: "chat_only",
  description: "Only in chats",
  schema: z.object({ path: z.string().describe("A path"), n: z.number().int().optional() }),
  available: (s) => s.threadKind === "CHAT" && s.flags.sandboxEnabled,
  execute: async () => ({ output: "ok" }),
});
const always = defineTool({
  name: "always",
  description: "Always",
  schema: z.object({}),
  available: () => true,
  execute: async () => ({ output: "ok" }),
});

describe("ToolRegistry", () => {
  it("filters by scope and model capability", () => {
    const reg = new ToolRegistry([chatOnly, always]);
    expect(reg.select({ threadKind: "CHAT", model: { supportsFunctionTools: true }, flags }).names()).toEqual(["chat_only", "always"]);
    expect(reg.select({ threadKind: "SUBAGENT", model: { supportsFunctionTools: true }, flags }).names()).toEqual(["always"]);
    expect(reg.select({ threadKind: "CHAT", model: { supportsFunctionTools: true }, flags: { ...flags, sandboxEnabled: false } }).names()).toEqual(["always"]);
    expect(reg.select({ threadKind: "CHAT", model: { supportsFunctionTools: false }, flags }).size).toBe(0);
  });

  it("rejects duplicate names", () => {
    expect(() => new ToolRegistry([always, always])).toThrow(/Duplicate/);
  });

  it("produces function specs from zod schemas", () => {
    const set = new ToolRegistry([chatOnly]).select({ threadKind: "CHAT", model: { supportsFunctionTools: true }, flags });
    expect(set.specs[0]).toMatchObject({
      type: "function",
      name: "chat_only",
      description: "Only in chats",
      strict: false,
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "A path" }, n: { type: "integer" } },
        required: ["path"],
      },
    });
    expect(set.specs[0].parameters.$schema).toBeUndefined();
  });
});

describe("runToolCall", () => {
  it("times out", async () => {
    const slow = defineTool({
      name: "slow",
      description: "",
      schema: z.object({}),
      available: () => true,
      timeoutMs: 20,
      execute: () => new Promise(() => {}),
    });
    const res = await runToolCall(slow, { name: "slow", arguments: "{}" }, ctx());
    expect(res).toMatchObject({ isError: true });
    expect(res.output).toMatch(/timed out/);
  });

  it("reports aborts", async () => {
    const ac = new AbortController();
    const slow = defineTool({
      name: "slow",
      description: "",
      schema: z.object({}),
      available: () => true,
      execute: () => new Promise(() => {}),
    });
    const p = runToolCall(slow, { name: "slow", arguments: "" }, ctx(ac.signal));
    ac.abort();
    expect(await p).toMatchObject({ aborted: true, isError: true });
  });

  it("converts thrown errors to error outputs", async () => {
    const bad = defineTool({
      name: "bad",
      description: "",
      schema: z.object({}),
      available: () => true,
      execute: async () => {
        throw new Error("kaboom");
      },
    });
    expect(await runToolCall(bad, { name: "bad", arguments: "{}" }, ctx())).toEqual({ output: "Error: kaboom", isError: true });
  });
});
