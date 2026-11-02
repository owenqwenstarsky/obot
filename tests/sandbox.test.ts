import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeSandboxPath, SandboxService } from "@/server/sandbox/sandbox";
import { bashTool, writeFileTool } from "@/server/agent/tools/sandbox";
import type { SandboxApi, ToolContext } from "@/server/agent/tools/types";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "obot-sandbox-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const svc = (opts: Partial<ConstructorParameters<typeof SandboxService>[0]> = {}) =>
  new SandboxService({ dir, python: () => false, ...opts });

describe("SandboxService", () => {
  it("executes commands with files persisting between calls in /home/user", async () => {
    const s = svc();
    const a = await s.exec("t1", "mkdir -p data && echo hello > data/a.txt && pwd", { timeoutMs: 10_000 });
    expect(a).toEqual({ stdout: "/home/user\n", stderr: "", exitCode: 0 });
    const b = await s.exec("t1", "cat data/a.txt; echo $HOME", { timeoutMs: 10_000 });
    expect(b.stdout).toBe("hello\n/home/user\n");
    const c = await s.exec("t1", "cat missing.txt", { timeoutMs: 10_000 });
    expect(c.exitCode).not.toBe(0);
    expect(c.stderr).toMatch(/No such file/);
  });

  it("persists snapshots and restores them in a fresh service (restart)", async () => {
    const s1 = svc();
    await s1.exec("t1", "mkdir -p empty-dir out && printf 'a,b\\n1,2\\n' > out/x.csv", { timeoutMs: 10_000 });
    await s1.writeFile("t1", "notes/readme.md", "# Hi\n");
    expect(await readdir(dir)).toEqual(["t1.json.gz"]);

    const s2 = svc();
    const r = await s2.exec("t1", "cat out/x.csv notes/readme.md && test -d empty-dir && echo dir-ok", { timeoutMs: 10_000 });
    expect(r.stdout).toBe("a,b\n1,2\n# Hi\ndir-ok\n");
    const entries = await s2.list("t1");
    expect(entries.filter((e) => !e.isDir).map((e) => e.path)).toEqual([
      "/home/user/notes/readme.md",
      "/home/user/out/x.csv",
    ]);
    expect(new TextDecoder().decode((await s2.read("t1", "out/x.csv"))!)).toBe("a,b\n1,2\n");
  });

  it("keeps sandboxes isolated and reports missing ones as empty", async () => {
    const s = svc();
    await s.writeFile("t1", "a.txt", "one");
    expect((await s.exec("t2", "ls", { timeoutMs: 10_000 })).stdout).toBe("");
    expect(await s.list("nope")).toEqual([]);
    expect(await s.read("nope", "a.txt")).toBeNull();
    expect(await s.exists("t1")).toBe(true);
  });

  it("does not rewrite the snapshot when nothing changed", async () => {
    const s = svc();
    await s.writeFile("t1", "a.txt", "one");
    const before = (await import("node:fs/promises")).stat(path.join(dir, "t1.json.gz"));
    const m1 = (await before).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    await s.exec("t1", "cat a.txt", { timeoutMs: 10_000 });
    const m2 = (await (await import("node:fs/promises")).stat(path.join(dir, "t1.json.gz"))).mtimeMs;
    expect(m2).toBe(m1);
  });

  it("serializes concurrent commands on one sandbox", async () => {
    const s = svc();
    await Promise.all([
      s.exec("t1", "echo 1 >> log.txt", { timeoutMs: 10_000 }),
      s.exec("t1", "echo 2 >> log.txt", { timeoutMs: 10_000 }),
      s.exec("t1", "echo 3 >> log.txt", { timeoutMs: 10_000 }),
    ]);
    expect((await s.exec("t1", "cat log.txt", { timeoutMs: 10_000 })).stdout).toBe("1\n2\n3\n");
  });

  it("enforces the filesystem size cap", async () => {
    const s = svc({ maxFileSystemBytes: 4 * 1024 * 1024 });
    const r = await s.exec("t1", "seq 1 2000000 > big.txt; echo done", { timeoutMs: 30_000 });
    expect(r.stderr.length + (r.exitCode ? 1 : 0)).toBeGreaterThan(0);
  });

  it("times out long commands and honours abort signals", async () => {
    const s = svc();
    const t = await s.exec("t1", "sleep 5", { timeoutMs: 200 });
    expect(t.exitCode).not.toBe(0);
    expect(t.stderr).toMatch(/timed out/);
    const ac = new AbortController();
    const p = s.exec("t1", "sleep 5", { timeoutMs: 10_000, signal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    expect((await p).exitCode).not.toBe(0);
  });

  it("refuses writes to system paths and normalizes relative paths", async () => {
    const s = svc();
    await expect(s.writeFile("t1", "/bin/evil", "x")).rejects.toThrow(/Can't write/);
    expect(normalizeSandboxPath("a/../b.txt")).toBe("/home/user/b.txt");
    expect(normalizeSandboxPath("/tmp/x/")).toBe("/tmp/x");
    await expect(s.exec("../escape", "ls", { timeoutMs: 1000 })).rejects.toThrow(/Invalid sandbox id/);
  });

  it("deletes snapshots", async () => {
    const s = svc();
    await s.writeFile("t1", "a.txt", "one");
    await s.delete("t1");
    expect(await readdir(dir)).toEqual([]);
    expect(await s.exists("t1")).toBe(false);
  });
});

describe("sandbox tools", () => {
  function ctx(sandbox: SandboxApi): ToolContext {
    return {
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
      services: { sandbox, steering: { onEnqueue: () => () => {}, hasPending: () => false } },
    };
  }

  it("bash formats output for the model and display, truncating large output", async () => {
    const big = "x".repeat(40_000);
    const fake: SandboxApi = {
      exec: async () => ({ stdout: big, stderr: "warn", exitCode: 2 }),
      writeFile: async () => ({ path: "/home/user/a", bytes: 1 }),
    };
    const res = await bashTool.execute({ command: "make" }, ctx(fake));
    expect(res.output.startsWith("exit code: 2\nstdout:\n")).toBe(true);
    expect(res.output.length).toBeLessThan(20_000);
    expect(res.output).toContain("stderr:\nwarn");
    expect(res.display).toMatchObject({ kind: "bash", command: "make", exitCode: 2, stderr: "warn", truncated: true });
  });

  it("write_file reports the normalized path and size", async () => {
    const s = svc();
    const api: SandboxApi = {
      exec: (c, o) => s.exec("t1", c, o),
      writeFile: (p, c) => s.writeFile("t1", p, c),
    };
    const res = await writeFileTool.execute({ path: "docs/x.md", content: "héllo" }, ctx(api));
    expect(res.display).toEqual({ kind: "write_file", path: "/home/user/docs/x.md", bytes: 6 });
  });
});
