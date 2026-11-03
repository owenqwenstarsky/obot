import { describe, expect, it } from "vitest";
import {
  buildInstructions,
  MEMORY_PROMPT_CHARS,
  MEMORY_PROMPT_LIMIT,
  memorySection,
  projectSection,
  selectMemories,
  userSection,
} from "@/server/agent/system-prompt";
import { buildProjectContext, PROJECT_FILE_CHARS, PROJECT_TOTAL_CHARS } from "@/server/projects-core";
import { forgetTool, rememberTool } from "@/server/agent/tools/memory";
import { ToolRegistry } from "@/server/agent/tools/registry";
import type { AgentFlags, MemoryApi, ToolContext } from "@/server/agent/tools/types";

const flags: AgentFlags = {
  sandboxEnabled: false,
  sandboxPythonEnabled: false,
  artifactsEnabled: false,
  inlineUiEnabled: false,
  fetchUrlEnabled: false,
  memoryEnabled: true,
  subagentsEnabled: false,
  subagentMaxConcurrent: 1,
  subagentModelCount: 0,
};

const ctx = (memories?: MemoryApi): ToolContext => ({
  userId: "u",
  threadId: "t",
  rootThreadId: "t",
  runId: "r",
  messageId: "m",
  callId: "c",
  partIndex: 0,
  step: 0,
  signal: new AbortController().signal,
  emit: { patch: () => {}, log: () => {} },
  services: { memories, steering: { onEnqueue: () => () => {}, hasPending: () => false } },
});

describe("project context", () => {
  it("caps each file and the total, in order", () => {
    const big = "x".repeat(PROJECT_FILE_CHARS * 2);
    const files = Array.from({ length: 5 }, (_, i) => ({ fileName: `f${i}.md`, text: big }));
    const p = buildProjectContext({ name: "P", instructions: "  Be formal.  ", files });
    expect(p.instructions).toBe("Be formal.");
    const included = p.files.filter((f) => !f.omitted);
    expect(included.every((f) => f.truncated)).toBe(true);
    expect(included.reduce((n, f) => n + f.text.length, 0)).toBeLessThanOrEqual(PROJECT_TOTAL_CHARS + 200);
    expect(p.files.at(-1)?.omitted).toBe(true);
  });

  it("renders instructions, documents, and omitted files", () => {
    const p = buildProjectContext({
      name: "Grant",
      instructions: "Formal tone.",
      files: [
        { fileName: 'brief "v2".md', text: "Budget: 10k", sandboxPath: "/home/user/project/brief _v2_.md" },
        { fileName: "empty.pdf", text: "" },
      ],
    });
    const out = projectSection(p);
    expect(out).toContain("## Project: Grant");
    expect(out).toContain("<project_instructions>\nFormal tone.\n</project_instructions>");
    expect(out).toContain('<document name="brief &quot;v2&quot;.md" sandbox_path="/home/user/project/brief _v2_.md">\nBudget: 10k\n</document>');
    expect(out).toContain("[No text could be extracted from this file.]");
  });
});

describe("user instructions and memories", () => {
  it("renders only the fields that are set", () => {
    expect(userSection({ aboutMe: "  ", responseStyle: null })).toBeNull();
    const out = userSection({ aboutMe: "I'm a nurse.", responseStyle: "Short answers." })!;
    expect(out).toContain("<about_user>\nI'm a nurse.\n</about_user>");
    expect(out).toContain("<response_style>\nShort answers.\n</response_style>");
  });

  it("caps memories by count and characters", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}`, content: "fact" }));
    expect(selectMemories(many)).toHaveLength(MEMORY_PROMPT_LIMIT);
    const long = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, content: "y".repeat(1000) }));
    const picked = selectMemories(long);
    expect(picked.length).toBeLessThan(20);
    expect(picked.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(MEMORY_PROMPT_CHARS);
  });

  it("lists memories with ids and only explains tools when available", () => {
    const withTools = memorySection([{ id: "abc", content: "Prefers\nmetric" }], true);
    expect(withTools).toContain("- [abc] Prefers metric");
    expect(withTools).toContain("`remember`");
    expect(memorySection([], false)).toContain("(No memories saved yet.)");
    expect(memorySection([], false)).not.toContain("`remember`");
  });

  it("orders sections and keeps personalization out of sub-agents", () => {
    const args = {
      adminPrompt: "ADMIN",
      toolNames: ["remember"],
      flags,
      project: buildProjectContext({ name: "P", instructions: "PROJ", files: [] }),
      user: { aboutMe: "ABOUT", responseStyle: null },
      memories: [{ id: "m1", content: "MEM" }],
    };
    const chat = buildInstructions({ ...args, kind: "CHAT" })!;
    const order = ["ADMIN", "PROJ", "ABOUT", "MEM"].map((s) => chat.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const sub = buildInstructions({ ...args, kind: "SUBAGENT" })!;
    expect(sub).not.toContain("PROJ");
    expect(sub).not.toContain("ABOUT");
    expect(sub).not.toContain("MEM");
  });
});

describe("memory tools", () => {
  it("are only offered in chats with memory on", () => {
    const reg = new ToolRegistry([rememberTool, forgetTool]);
    const pick = (threadKind: "CHAT" | "SUBAGENT", memoryEnabled: boolean) =>
      reg.select({ threadKind, model: { supportsFunctionTools: true }, flags: { ...flags, memoryEnabled } }).names();
    expect(pick("CHAT", true)).toEqual(["remember", "forget"]);
    expect(pick("CHAT", false)).toEqual([]);
    expect(pick("SUBAGENT", true)).toEqual([]);
  });

  it("save and forget through the service", async () => {
    const store = new Map<string, string>();
    const api: MemoryApi = {
      add: async (content) => {
        store.set("m1", content);
        return { id: "m1", content };
      },
      remove: async (id) => {
        const content = store.get(id);
        store.delete(id);
        return content ? { content } : null;
      },
    };
    const saved = await rememberTool.execute({ content: "Has two cats" }, ctx(api));
    expect(saved.output).toBe("Saved to memory as [m1]: Has two cats");
    expect(saved.display).toEqual({ kind: "memory", action: "saved", memoryId: "m1", content: "Has two cats" });
    const forgot = await forgetTool.execute({ id: "m1" }, ctx(api));
    expect(forgot.display).toMatchObject({ action: "forgotten", content: "Has two cats" });
    expect(await forgetTool.execute({ id: "m1" }, ctx(api))).toEqual({ output: "Error: no memory with id m1.", isError: true });
  });

  it("report service errors as tool errors", async () => {
    const api: MemoryApi = {
      add: async () => {
        throw new Error("Memory is full");
      },
      remove: async () => null,
    };
    expect(await rememberTool.execute({ content: "x" }, ctx(api))).toEqual({ output: "Error: Memory is full", isError: true });
  });
});
