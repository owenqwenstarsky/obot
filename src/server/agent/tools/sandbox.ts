import { z } from "zod";
import { truncateMiddle } from "@/server/llm/transcript";
import { defineTool } from "@/server/agent/tools/types";

const MODEL_OUTPUT_CAP = 16_000;
const DISPLAY_CAP = 16_000;

export const bashTool = defineTool({
  name: "bash",
  description:
    "Run a bash script in your sandbox: a lightweight, in-memory Linux-like shell (no network, no package installs, no real processes). " +
    "Files persist for this thread under /home/user (the working directory). Available: coreutils-style commands (ls, cat, grep, rg, sed, awk, sort, find, diff, tar, gzip, base64, …), " +
    "jq, yq, xan (CSV), sqlite3, js-exec (JavaScript/TypeScript via QuickJS) and, when enabled, python3. " +
    "Environment variables and cd do not persist between calls; only files do. Use it for calculations, data processing, and drafting files the user can download.",
  schema: z.object({
    command: z.string().min(1).max(100_000).describe("The bash script to run."),
    timeout_s: z.number().int().min(1).max(120).optional().describe("Timeout in seconds (default 30, max 120)."),
  }),
  available: (s) => s.flags.sandboxEnabled,
  concurrency: "serial",
  timeoutMs: 130_000,
  execute: async (args, ctx) => {
    const { command, timeout_s } = args as { command: string; timeout_s?: number };
    const sandbox = ctx.services.sandbox;
    if (!sandbox) return { output: "Error: the sandbox is not available.", isError: true };
    const res = await sandbox.exec(command, { timeoutMs: (timeout_s ?? 30) * 1000, signal: ctx.signal });
    const stdout = truncateMiddle(res.stdout, MODEL_OUTPUT_CAP);
    const stderr = truncateMiddle(res.stderr, MODEL_OUTPUT_CAP);
    const truncated = stdout.length !== res.stdout.length || stderr.length !== res.stderr.length;
    const output = [`exit code: ${res.exitCode}`, stdout && `stdout:\n${stdout}`, stderr && `stderr:\n${stderr}`]
      .filter(Boolean)
      .join("\n");
    return {
      output,
      display: {
        kind: "bash",
        command: command.slice(0, DISPLAY_CAP),
        exitCode: res.exitCode,
        stdout: truncateMiddle(res.stdout, DISPLAY_CAP),
        stderr: truncateMiddle(res.stderr, DISPLAY_CAP),
        truncated,
      },
    };
  },
});

export const writeFileTool = defineTool({
  name: "write_file",
  description:
    "Create or overwrite a text file in your sandbox (parent directories are created). Prefer this over heredocs for anything longer than a few lines. Relative paths are under /home/user.",
  schema: z.object({
    path: z.string().min(1).max(1000).describe("File path, e.g. report.md or /home/user/data/out.csv"),
    content: z.string().max(2_000_000).describe("Full file contents."),
  }),
  available: (s) => s.flags.sandboxEnabled,
  concurrency: "serial",
  execute: async (args, ctx) => {
    const { path, content } = args as { path: string; content: string };
    const sandbox = ctx.services.sandbox;
    if (!sandbox) return { output: "Error: the sandbox is not available.", isError: true };
    const res = await sandbox.writeFile(path, content);
    return { output: `Wrote ${res.bytes} bytes to ${res.path}.`, display: { kind: "write_file", path: res.path, bytes: res.bytes } };
  },
});

export const sandboxTools = [bashTool, writeFileTool];
