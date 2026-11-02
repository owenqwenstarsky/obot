/**
 * Low-end bash sandbox backed by just-bash (a TypeScript bash interpreter over an in-memory
 * virtual filesystem; no real processes, no network). One sandbox per top-level thread;
 * sub-agents share their parent's. The filesystem is snapshotted to disk after changes so it
 * survives eviction and restarts.
 *
 * No server-only imports: the storage directory and settings are injected so this can be
 * unit-tested in memory.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Bash, InMemoryFs, type IFileSystem } from "just-bash";

export const SANDBOX_HOME = "/home/user";
/** Paths that belong to the interpreter's default layout, never persisted or listed. */
const SYSTEM_PREFIXES = ["/bin", "/usr", "/dev", "/proc"];

export type SandboxOptions = {
  /** Directory for snapshots. */
  dir: string;
  python: () => boolean | Promise<boolean>;
  maxFileSystemBytes?: number;
  idleMs?: number;
  maxLive?: number;
  now?: () => number;
};

export type SandboxEntry = { path: string; size: number; isDir: boolean };

type Snapshot = { v: 1; entries: { p: string; d?: 1; b?: string; m?: number }[] };

type Live = {
  bash: Bash;
  fs: IFileSystem;
  python: boolean;
  lastUsed: number;
  fingerprint: string;
  lock: Promise<unknown>;
};

const SAFE_ID = /^[\w-]{1,128}$/;

function isUserPath(p: string) {
  return p !== "/" && !SYSTEM_PREFIXES.some((s) => p === s || p.startsWith(`${s}/`));
}

/** Normalize a user-supplied path to an absolute sandbox path (relative paths are under $HOME). */
export function normalizeSandboxPath(p: string): string {
  const abs = p.startsWith("/") ? p : `${SANDBOX_HOME}/${p}`;
  const norm = path.posix.normalize(abs);
  return norm.length > 1 && norm.endsWith("/") ? norm.slice(0, -1) : norm;
}

export class SandboxService {
  private live = new Map<string, Live>();
  private pending = new Map<string, Promise<Live>>();
  private readonly maxBytes: number;
  private readonly idleMs: number;
  private readonly maxLive: number;
  private readonly now: () => number;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: SandboxOptions) {
    this.maxBytes = opts.maxFileSystemBytes ?? 64 * 1024 * 1024;
    this.idleMs = opts.idleMs ?? 10 * 60 * 1000;
    this.maxLive = opts.maxLive ?? 50;
    this.now = opts.now ?? Date.now;
  }

  private file(id: string) {
    if (!SAFE_ID.test(id)) throw new Error("Invalid sandbox id");
    return path.join(this.opts.dir, `${id}.json.gz`);
  }

  private startSweeper() {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.evictIdle(), 60_000);
    (this.sweeper as { unref?: () => void }).unref?.();
  }

  /** Drop idle sandboxes from memory (their state is already on disk). */
  evictIdle() {
    const cutoff = this.now() - this.idleMs;
    for (const [id, l] of this.live) if (l.lastUsed < cutoff) this.live.delete(id);
  }

  private evictOverflow() {
    if (this.live.size <= this.maxLive) return;
    const oldest = [...this.live.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [id] of oldest.slice(0, this.live.size - this.maxLive)) this.live.delete(id);
  }

  private async loadSnapshot(id: string): Promise<Snapshot | null> {
    try {
      const raw = await readFile(this.file(id));
      const parsed = JSON.parse(gunzipSync(raw).toString("utf8")) as Snapshot;
      return parsed?.v === 1 && Array.isArray(parsed.entries) ? parsed : null;
    } catch {
      return null;
    }
  }

  private async create(id: string): Promise<Live> {
    const python = !!(await this.opts.python());
    const snap = await this.loadSnapshot(id);
    const fs = new InMemoryFs();
    const bash = new Bash({
      fs,
      cwd: SANDBOX_HOME,
      env: { HOME: SANDBOX_HOME, USER: "user" },
      executionLimitProfile: "hardened",
      executionLimits: { maxFileSystemBytes: this.maxBytes, maxExecutionTimeMs: 120_000 },
      python,
      javascript: true,
    });
    if (snap) {
      for (const e of snap.entries) {
        if (!isUserPath(e.p)) continue;
        if (e.d) await fs.mkdir(e.p, { recursive: true });
      }
      for (const e of snap.entries) {
        if (e.d || !isUserPath(e.p)) continue;
        await fs.mkdir(path.posix.dirname(e.p), { recursive: true });
        await fs.writeFile(e.p, Buffer.from(e.b ?? "", "base64"));
        if (e.m != null) await fs.chmod(e.p, e.m).catch(() => undefined);
      }
    }
    const live: Live = { bash, fs, python, lastUsed: this.now(), fingerprint: "", lock: Promise.resolve() };
    live.fingerprint = await this.fingerprint(live.fs);
    return live;
  }

  private async get(id: string): Promise<Live> {
    if (!SAFE_ID.test(id)) throw new Error("Invalid sandbox id");
    this.startSweeper();
    const python = !!(await this.opts.python());
    const existing = this.live.get(id);
    if (existing && existing.python === python) {
      existing.lastUsed = this.now();
      return existing;
    }
    if (existing) {
      // Python setting changed: rebuild from the persisted state.
      await existing.lock;
      this.live.delete(id);
    }
    let p = this.pending.get(id);
    if (!p) {
      p = this.create(id).finally(() => this.pending.delete(id));
      this.pending.set(id, p);
    }
    const l = await p;
    this.live.set(id, l);
    this.evictOverflow();
    return l;
  }

  /** Run `fn` exclusively on one sandbox. */
  private async withLock<T>(id: string, fn: (l: Live) => Promise<T>): Promise<T> {
    const l = await this.get(id);
    const run = l.lock.then(() => fn(l));
    l.lock = run.catch(() => undefined);
    try {
      return await run;
    } finally {
      l.lastUsed = this.now();
    }
  }

  private async userEntries(fs: IFileSystem): Promise<{ path: string; isDir: boolean; size: number; mode: number; mtime: number }[]> {
    const out = [];
    for (const p of fs.getAllPaths()) {
      if (!isUserPath(p)) continue;
      try {
        const st = await fs.lstat(p);
        if (st.isSymbolicLink) continue;
        out.push({ path: p, isDir: st.isDirectory, size: st.size, mode: st.mode, mtime: st.mtime.getTime() });
      } catch {
        // vanished
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async fingerprint(fs: IFileSystem): Promise<string> {
    const entries = await this.userEntries(fs);
    return entries.map((e) => `${e.path}:${e.isDir ? "d" : e.size}:${e.mtime}`).join("|");
  }

  private async persistIfChanged(id: string, l: Live) {
    const fp = await this.fingerprint(l.fs);
    if (fp === l.fingerprint) return;
    const entries = await this.userEntries(l.fs);
    const snap: Snapshot = { v: 1, entries: [] };
    for (const e of entries) {
      if (e.isDir) snap.entries.push({ p: e.path, d: 1 });
      else {
        const bytes = await l.fs.readFileBuffer(e.path);
        snap.entries.push({ p: e.path, b: Buffer.from(bytes).toString("base64"), m: e.mode });
      }
    }
    await mkdir(this.opts.dir, { recursive: true });
    const target = this.file(id);
    const tmp = `${target}.${process.pid}.${this.now()}.tmp`;
    await writeFile(tmp, gzipSync(JSON.stringify(snap)));
    await rename(tmp, target);
    l.fingerprint = fp;
  }

  async exec(
    id: string,
    command: string,
    opts: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return this.withLock(id, async (l) => {
      const timeout = AbortSignal.timeout(opts.timeoutMs);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      let res: { stdout: string; stderr: string; exitCode: number };
      try {
        const r = await l.bash.exec(command, { signal, rawScript: true });
        res = { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
      } catch (err) {
        res = { stdout: "", stderr: err instanceof Error ? err.message : String(err), exitCode: 1 };
      }
      if (timeout.aborted && !opts.signal?.aborted) {
        res.stderr += `${res.stderr && !res.stderr.endsWith("\n") ? "\n" : ""}Command timed out after ${Math.round(opts.timeoutMs / 1000)}s.`;
        res.exitCode = res.exitCode || 124;
      }
      await this.persistIfChanged(id, l);
      return res;
    });
  }

  async writeFile(id: string, filePath: string, content: string): Promise<{ path: string; bytes: number }> {
    const p = normalizeSandboxPath(filePath);
    if (!isUserPath(p)) throw new Error(`Can't write to ${p}.`);
    return this.withLock(id, async (l) => {
      await l.fs.mkdir(path.posix.dirname(p), { recursive: true });
      await l.fs.writeFile(p, content);
      await this.persistIfChanged(id, l);
      return { path: p, bytes: Buffer.byteLength(content) };
    });
  }

  /** Whether a sandbox has any persisted or live state. */
  async exists(id: string): Promise<boolean> {
    if (this.live.has(id)) return true;
    return (await this.loadSnapshot(id)) != null;
  }

  async list(id: string): Promise<SandboxEntry[]> {
    if (!(await this.exists(id))) return [];
    return this.withLock(id, async (l) =>
      (await this.userEntries(l.fs)).map((e) => ({ path: e.path, size: e.isDir ? 0 : e.size, isDir: e.isDir })),
    );
  }

  async read(id: string, filePath: string): Promise<Uint8Array | null> {
    if (!(await this.exists(id))) return null;
    const p = normalizeSandboxPath(filePath);
    if (!isUserPath(p)) return null;
    return this.withLock(id, async (l) => {
      try {
        const st = await l.fs.stat(p);
        if (!st.isFile) return null;
        return await l.fs.readFileBuffer(p);
      } catch {
        return null;
      }
    });
  }

  async delete(id: string) {
    this.live.delete(id);
    await rm(this.file(id), { force: true });
  }
}
