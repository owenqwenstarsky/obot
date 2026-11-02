import { z } from "zod";
import type { FunctionToolSpec } from "@/server/llm/request-builder";
import type { PendingFunctionCall } from "@/server/llm/stream-normalizer";
import type { ToolContext, ToolDefinition, ToolResult, ToolScope } from "@/server/agent/tools/types";

export const DEFAULT_TOOL_TIMEOUT_MS = 120_000;

function toSpec(def: ToolDefinition): FunctionToolSpec {
  const schema = z.toJSONSchema(def.schema, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return { type: "function", name: def.name, description: def.description, parameters: schema, strict: false };
}

/** The tools available to one run. */
export class ToolSet {
  readonly specs: FunctionToolSpec[];
  private readonly byName: Map<string, ToolDefinition>;

  constructor(defs: ToolDefinition[]) {
    this.byName = new Map(defs.map((d) => [d.name, d]));
    this.specs = defs.map(toSpec);
  }

  get(name: string): ToolDefinition | undefined {
    return this.byName.get(name);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  names(): string[] {
    return [...this.byName.keys()];
  }

  get size(): number {
    return this.byName.size;
  }
}

export const EMPTY_TOOLSET = new ToolSet([]);

export class ToolRegistry {
  private readonly defs: ToolDefinition[];

  constructor(defs: ToolDefinition[]) {
    const seen = new Set<string>();
    for (const d of defs) {
      if (seen.has(d.name)) throw new Error(`Duplicate tool name: ${d.name}`);
      seen.add(d.name);
    }
    this.defs = defs;
  }

  select(scope: ToolScope): ToolSet {
    if (!scope.model.supportsFunctionTools) return EMPTY_TOOLSET;
    return new ToolSet(this.defs.filter((d) => d.available(scope)));
  }

  all(): ToolDefinition[] {
    return this.defs.slice();
  }
}

class ToolTimeoutError extends Error {}

/**
 * Validate and execute one function call. Never throws: every failure (unknown tool, bad
 * JSON, schema errors, exceptions, timeout, abort) becomes an error output for the model.
 */
export async function runToolCall(
  def: ToolDefinition | undefined,
  call: Pick<PendingFunctionCall, "name" | "arguments">,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!def) return { output: `Error: unknown tool "${call.name}".`, isError: true };
  if (ctx.signal.aborted) return { output: "Interrupted by the user before this tool ran.", isError: true, aborted: true };

  let raw: unknown;
  try {
    raw = call.arguments.trim() ? JSON.parse(call.arguments) : {};
  } catch {
    return { output: "Error: the tool arguments were not valid JSON. Retry with a valid JSON object.", isError: true };
  }
  const parsed = def.schema.safeParse(raw);
  if (!parsed.success) {
    return { output: `Error: invalid arguments for ${def.name}:\n${z.prettifyError(parsed.error)}`, isError: true };
  }

  const timeoutMs = def.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ToolTimeoutError()), timeoutMs);
      onAbort = () => reject(new DOMException("Aborted", "AbortError"));
      ctx.signal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([def.execute(parsed.data, ctx), guard]);
  } catch (err) {
    if (ctx.signal.aborted) return { output: "Interrupted by the user.", isError: true, aborted: true };
    if (err instanceof ToolTimeoutError) {
      return { output: `Error: ${def.name} timed out after ${Math.round(timeoutMs / 1000)}s.`, isError: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Error: ${message}`, isError: true };
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) ctx.signal.removeEventListener("abort", onAbort);
  }
}
