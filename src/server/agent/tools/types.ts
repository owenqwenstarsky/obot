/**
 * Local function tools: definitions, execution context, and the per-run services tools use.
 * Kept free of server-only imports so tools can be unit-tested with fakes.
 */
import type { z } from "zod";
import type { ArtifactKindValue, FunctionToolPart, SubagentTaskStatusValue, ToolDisplay } from "@/lib/parts";

export type ThreadKindValue = "CHAT" | "SUBAGENT";

/** Feature flags and limits that decide which tools a run gets. */
export type AgentFlags = {
  sandboxEnabled: boolean;
  sandboxPythonEnabled: boolean;
  artifactsEnabled: boolean;
  inlineUiEnabled: boolean;
  fetchUrlEnabled: boolean;
  /** Memory tools: the instance switch AND the user's own setting (resolved per run). */
  memoryEnabled: boolean;
  subagentsEnabled: boolean;
  subagentMaxConcurrent: number;
  /** Number of models on the sub-agent allowlist. Delegation is unavailable when 0. */
  subagentModelCount: number;
};

export type ToolScope = {
  threadKind: ThreadKindValue;
  model: { supportsFunctionTools: boolean };
  flags: AgentFlags;
};

export type ToolResult = {
  /** Text returned to the model as the function_call_output. */
  output: string;
  display?: ToolDisplay;
  isError?: boolean;
  /** The tool stopped because the step was interrupted or the run was stopped. */
  aborted?: boolean;
};

// ─── Services (bound to the current run; features provide implementations) ───

export type SandboxExecResult = { stdout: string; stderr: string; exitCode: number };

export interface MemoryApi {
  add(content: string): Promise<{ id: string; content: string }>;
  remove(id: string): Promise<{ content: string } | null>;
}

export interface WebApi {
  fetch(url: string, signal: AbortSignal): Promise<import("@/server/web/fetch-url").FetchedPage>;
}

export interface SandboxApi {
  exec(command: string, opts: { timeoutMs: number; signal: AbortSignal }): Promise<SandboxExecResult>;
  writeFile(path: string, content: string): Promise<{ path: string; bytes: number }>;
}

export type ArtifactRef = { artifactId: string; version: number; title: string; kind: ArtifactKindValue };

export interface ArtifactApi {
  create(args: { title: string; kind: ArtifactKindValue; content: string }): Promise<ArtifactRef>;
  update(args: { artifactId: string; content: string; title?: string }): Promise<ArtifactRef>;
}

export type TaskInfo = {
  taskId: string;
  title: string;
  childThreadId: string;
  modelId: string;
  status: SubagentTaskStatusValue;
  result: string | null;
  error: string | null;
};

export type WaitOutcome = {
  reason: "settled" | "steer" | "interrupted" | "timeout";
  tasks: TaskInfo[];
};

export interface SubagentToolApi {
  capabilities(): Promise<Record<string, unknown>>;
  delegate(args: { title: string; prompt: string; model?: string; effort?: string; callId: string }): Promise<TaskInfo>;
  waitAny(
    taskIds: string[],
    opts: { timeoutMs: number; signal: AbortSignal; onSteer?: (cb: () => void) => () => void },
  ): Promise<WaitOutcome>;
  status(taskIds?: string[]): Promise<TaskInfo[]>;
  cancel(taskId: string): Promise<TaskInfo>;
}

export interface ToolServices {
  sandbox?: SandboxApi;
  web?: WebApi;
  memories?: MemoryApi;
  artifacts?: ArtifactApi;
  tasks?: SubagentToolApi;
  steering: { onEnqueue(cb: () => void): () => void; hasPending(): boolean };
}

export type ToolContext = {
  userId: string;
  threadId: string;
  rootThreadId: string;
  runId: string;
  messageId: string;
  callId: string;
  partIndex: number;
  step: number;
  /** Aborted when the user interrupts the step or stops the run. */
  signal: AbortSignal;
  emit: {
    patch(fn: (p: FunctionToolPart) => FunctionToolPart): void;
    log(delta: string): void;
  };
  services: ToolServices;
};

export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  available(scope: ToolScope): boolean;
  /** Serial tools in one step run one at a time, in call order. Default: parallel. */
  concurrency?: "parallel" | "serial";
  /** Default 120s. */
  timeoutMs?: number;
  execute(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
}

export function defineTool<S extends z.ZodType>(d: ToolDefinition<S>): ToolDefinition {
  return d as unknown as ToolDefinition;
}
