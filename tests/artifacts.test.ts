import { describe, expect, it } from "vitest";
import {
  cleanTitle,
  createArtifactApi,
  finalizePendingArtifact,
  MAX_ARTIFACT_CHARS,
  type ArtifactRow,
  type ArtifactStore,
} from "@/server/artifacts/core";
import { artifactCsp, artifactFileName, buildArtifactSrcDoc, scriptJson } from "@/lib/artifact-srcdoc";
import { partialJsonString } from "@/lib/partial-json";

function memoryStore() {
  const rows = new Map<string, ArtifactRow>();
  const versions: { artifactId: string; version: number; title: string; content: string; messageId: string }[] = [];
  let n = 0;
  const store: ArtifactStore = {
    async get(id) {
      return rows.get(id) ?? null;
    },
    async createWithVersion(a) {
      const row: ArtifactRow = {
        id: `a${++n}`,
        userId: a.userId,
        threadId: a.threadId,
        title: a.title,
        kind: a.kind,
        status: "READY",
        currentVersion: 1,
        deletedAt: null,
      };
      rows.set(row.id, row);
      versions.push({ artifactId: row.id, version: 1, title: a.title, content: a.content, messageId: a.messageId });
      return row;
    },
    async addVersion(a) {
      const row = rows.get(a.artifactId)!;
      const version = a.expectedVersion + 1;
      if (versions.some((v) => v.artifactId === a.artifactId && v.version === version)) throw new Error("conflict");
      versions.push({ artifactId: a.artifactId, version, title: a.title, content: a.content, messageId: a.messageId });
      const next = { ...row, currentVersion: version, title: a.title, status: "READY" as const, ...(a.kind ? { kind: a.kind } : {}) };
      rows.set(row.id, next);
      return next;
    },
    async markFailed(id) {
      const row = rows.get(id);
      if (row?.status === "GENERATING") rows.set(id, { ...row, status: "FAILED" });
    },
  };
  return { store, rows, versions };
}

const ctx = { userId: "u1", threadId: "t1", runId: "r1", messageId: "m1" };

describe("artifacts", () => {
  it("creates version 1 and appends versions on update", async () => {
    const { store, versions } = memoryStore();
    const api = createArtifactApi(store, ctx);
    const a = await api.create({ title: "  My   doc ", kind: "markdown", content: "# Hi" });
    expect(a).toEqual({ artifactId: "a1", version: 1, title: "My doc", kind: "markdown" });
    const b = await api.update({ artifactId: "a1", content: "# Hi v2" });
    expect(b).toMatchObject({ version: 2, title: "My doc" });
    const c = await api.update({ artifactId: "a1", content: "# v3", title: "Renamed" });
    expect(c).toMatchObject({ version: 3, title: "Renamed" });
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it("refuses to update other users' or missing artifacts, and empty/oversized content", async () => {
    const { store, rows } = memoryStore();
    const api = createArtifactApi(store, ctx);
    await api.create({ title: "x", kind: "html", content: "<p>x</p>" });
    rows.set("other", { ...rows.get("a1")!, id: "other", userId: "u2" });
    await expect(api.update({ artifactId: "other", content: "y" })).rejects.toThrow(/not found/);
    await expect(api.update({ artifactId: "nope", content: "y" })).rejects.toThrow(/not found/);
    await expect(api.create({ title: "x", kind: "react", content: "   " })).rejects.toThrow(/empty/);
    await expect(api.create({ title: "x", kind: "react", content: "x".repeat(MAX_ARTIFACT_CHARS + 1) })).rejects.toThrow(/too large/);
  });

  it("fills a background-generation placeholder exactly once", async () => {
    const { store, rows } = memoryStore();
    rows.set("p1", { id: "p1", userId: "u1", threadId: "t1", title: "Draft", kind: "MARKDOWN", status: "GENERATING", currentVersion: 0, deletedAt: null });
    const api = createArtifactApi(store, { ...ctx, pendingArtifactId: "p1" });
    const first = await api.create({ title: "Calculator", kind: "react", content: "export default () => null" });
    expect(first).toEqual({ artifactId: "p1", version: 1, title: "Calculator", kind: "react" });
    expect(rows.get("p1")).toMatchObject({ status: "READY", kind: "REACT" });
    const second = await api.create({ title: "Another", kind: "markdown", content: "x" });
    expect(second.artifactId).not.toBe("p1");
  });

  it("marks an unfilled placeholder FAILED when the run settles", async () => {
    const { store, rows } = memoryStore();
    rows.set("p1", { id: "p1", userId: "u1", threadId: "t1", title: "Draft", kind: "MARKDOWN", status: "GENERATING", currentVersion: 0, deletedAt: null });
    await finalizePendingArtifact(store, { pendingArtifactId: "p1", runStatus: "COMPLETED", error: null });
    expect(rows.get("p1")?.status).toBe("FAILED");
    // Already-filled placeholders are left alone.
    rows.set("p2", { ...rows.get("p1")!, id: "p2", status: "READY", currentVersion: 1 });
    await finalizePendingArtifact(store, { pendingArtifactId: "p2", runStatus: "FAILED", error: "x" });
    expect(rows.get("p2")?.status).toBe("READY");
  });

  it("cleans titles", () => {
    expect(cleanTitle("   ")).toBe("Untitled artifact");
    expect(cleanTitle("a".repeat(200))).toHaveLength(120);
  });
});

describe("artifact srcdoc", () => {
  const origin = "https://obot.example";
  it("embeds React source safely with a strict CSP", () => {
    const doc = buildArtifactSrcDoc("react", 'export default () => <p>{"</script><script>alert(1)</script>"}</p>', origin, "dark");
    expect(doc).toContain('id="artifact-source" data-kind="react"');
    expect(doc).not.toContain("</script><script>alert(1)");
    expect(doc).toContain(`${origin}/artifact-runtime/runtime.js`);
    expect(doc).toContain('class="dark"');
    expect(doc).toContain("connect-src &#39;none&#39;".replace(/&#39;/g, "'"));
  });

  it("injects the CSP before the artifact's own head content", () => {
    const doc = buildArtifactSrcDoc("html", "<html><head><script>x()</script></head><body><p>Hi</p></body></html>", origin, "light");
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<script>x()"));
    expect(doc).toMatch(/runtime\.js"><\/script><\/body>/);
    const frag = buildArtifactSrcDoc("html", "<p>fragment</p>", origin, "light");
    expect(frag.startsWith("<!doctype html>")).toBe(true);
    expect(frag).toContain("<body><p>fragment</p>");
  });

  it("CSP blocks network and only allows the runtime scripts", () => {
    const csp = artifactCsp(origin);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src 'unsafe-inline' 'unsafe-eval' ${origin}/artifact-runtime/`);
    expect(csp).toContain("connect-src 'none'");
  });

  it("escapes script-breaking characters in JSON", () => {
    expect(scriptJson("</script>\u2028")).toBe('"\\u003c/script>\\u2028"');
  });

  it("builds download file names", () => {
    expect(artifactFileName("Mortgage calc: v2!", "react")).toBe("Mortgage-calc-v2.tsx");
    expect(artifactFileName("", "markdown")).toBe("artifact.md");
  });
});

describe("partialJsonString", () => {
  it("extracts complete and in-progress string fields", () => {
    expect(partialJsonString('{"title":"Hello \\"there\\"","content":"line1\\nli', "title")).toBe('Hello "there"');
    expect(partialJsonString('{"title":"Hello","content":"line1\\nli', "content")).toBe("line1\nli");
    expect(partialJsonString('{"title":"x"}', "missing")).toBeNull();
    expect(partialJsonString('{"t":"\\u00e9', "t")).toBe("é");
  });
});
