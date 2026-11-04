import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessagePart } from "@/lib/parts";
import { buildShareSnapshot, isShareSnapshot, snapshotAttachmentIds, type ShareSnapshot } from "@/lib/share";
import { threadToMarkdown } from "@/lib/export";

const userParts: MessagePart[] = [
  { type: "user_image", id: "i", attachmentId: "img1", mime: "image/png" },
  { type: "user_file", id: "f", attachmentId: "doc1", fileName: "plan.pdf", mime: "application/pdf", size: 10 },
  { type: "user_text", id: "t", text: "Compare these" },
];
const assistantParts: MessagePart[] = [
  { type: "reasoning", id: "r", summary: "private chain of thought", startedAt: 0 },
  {
    type: "tool",
    tool: "web_search",
    id: "w",
    status: "completed",
    actions: [{ kind: "search", queries: ["obot pricing"] }],
    sources: [],
    startedAt: 0,
  },
  {
    type: "tool",
    tool: "function",
    id: "fn",
    callId: "c",
    name: "bash",
    status: "completed",
    argsText: "{}",
    log: "live log",
    display: { kind: "bash", command: "ls -la\necho hi", exitCode: 0, stdout: "", stderr: "", truncated: false },
    startedAt: 0,
  },
  { type: "text", id: "x", text: "It costs $5.", citations: [{ url: "https://e.com/p", title: "Pricing", start: 0, end: 12 }] },
];

const path = [
  { id: "u1", role: "USER" as const, parts: userParts, modelId: null, status: "COMPLETE" as const, createdAt: new Date("2026-01-01T00:00:00Z") },
  { id: "a1", role: "ASSISTANT" as const, parts: assistantParts, modelId: "gpt-x", status: "STREAMING" as const, createdAt: "2026-01-01T00:00:01Z" },
];

describe("share snapshots", () => {
  const snap = buildShareSnapshot("My thread", path, { now: new Date("2026-02-01T00:00:00Z"), modelName: (id) => (id === "gpt-x" ? "GPT X" : null) });

  it("freezes the path and drops private parts", () => {
    expect(snap).toMatchObject({ v: 1, title: "My thread", sharedAt: "2026-02-01T00:00:00.000Z" });
    expect(snap.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
    const a = snap.messages[1];
    expect(a.parts.some((p) => p.type === "reasoning")).toBe(false);
    const fn = a.parts.find((p) => p.type === "tool" && p.tool === "function");
    expect(fn && "log" in fn).toBe(false);
    expect(a.status).toBe("STOPPED");
    expect(a.modelName).toBe("GPT X");
    expect(snap.messages[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("lists exactly the referenced attachments", () => {
    expect([...snapshotAttachmentIds(snap)].sort()).toEqual(["doc1", "img1"]);
    expect(isShareSnapshot(snap)).toBe(true);
    expect(isShareSnapshot({ v: 2 })).toBe(false);
  });
});

describe("threadToMarkdown", () => {
  it("renders turns, tools, citations, and attachments", () => {
    const md = threadToMarkdown("My thread", path, { modelName: () => "GPT X", exportedAt: new Date("2026-03-04T00:00:00Z") });
    expect(md).toContain("# My thread");
    expect(md).toContain("_Exported from Obot on 2026-03-04_");
    expect(md).toContain("## You\n\n_[Image attached]_\n\n_[File attached: plan.pdf]_\n\nCompare these");
    expect(md).toContain("## Assistant (GPT X)");
    expect(md).toContain("> _Searched the web: “obot pricing”_");
    expect(md).toContain("> _Ran `ls -la` (exit 0)_");
    expect(md).not.toContain("private chain of thought");
    expect(md).toContain("**Sources**\n\n1. [Pricing](https://e.com/p)");
  });
});

// ── lookupShare against an in-memory DB ──

const state = {
  shares: [] as {
    id: string;
    tokenHash: string;
    userId: string;
    revokedAt: Date | null;
    snapshot: unknown;
    thread: { deletedAt: Date | null };
    user: { status: string };
  }[],
  sharingEnabled: true,
  attachments: [] as { id: string; userId: string }[],
};

vi.mock("@/server/db", () => ({
  db: {
    threadShare: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => state.shares.find((s) => s.tokenHash === where.tokenHash) ?? null,
    },
    attachment: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        state.attachments.find((a) => a.id === where.id && a.userId === where.userId) ?? null,
    },
  },
}));
vi.mock("@/server/settings", () => ({ getSettings: async () => ({ sharingEnabled: state.sharingEnabled }) }));
vi.mock("@/server/agent/turns", () => ({ getOwnedThread: async () => null }));
vi.mock("@/server/llm/models", () => ({ getAllCatalogModels: async () => [] }));

const { lookupShare, sharedAttachment } = await import("@/server/shares");
const { hashToken } = await import("@/server/auth/tokens");

describe("lookupShare", () => {
  const token = "a".repeat(43);
  const snapshot: ShareSnapshot = buildShareSnapshot("T", path);
  beforeEach(() => {
    state.sharingEnabled = true;
    state.shares = [
      { id: "s1", tokenHash: hashToken(token), userId: "u", revokedAt: null, snapshot, thread: { deletedAt: null }, user: { status: "ACTIVE" } },
    ];
    state.attachments = [
      { id: "img1", userId: "u" },
      { id: "other", userId: "u" },
    ];
  });

  it("resolves an active link", async () => {
    expect((await lookupShare(token))?.snapshot.title).toBe("T");
  });

  it("rejects malformed, unknown, revoked, deleted, disabled, or switched-off links", async () => {
    expect(await lookupShare("short")).toBeNull();
    expect(await lookupShare("b".repeat(43))).toBeNull();
    state.shares[0].revokedAt = new Date();
    expect(await lookupShare(token)).toBeNull();
    state.shares[0].revokedAt = null;
    state.shares[0].thread.deletedAt = new Date();
    expect(await lookupShare(token)).toBeNull();
    state.shares[0].thread.deletedAt = null;
    state.shares[0].user.status = "DISABLED";
    expect(await lookupShare(token)).toBeNull();
    state.shares[0].user.status = "ACTIVE";
    state.sharingEnabled = false;
    expect(await lookupShare(token)).toBeNull();
  });

  it("serves only attachments referenced by the snapshot", async () => {
    expect(await sharedAttachment(token, "img1")).toEqual({ id: "img1", userId: "u" });
    expect(await sharedAttachment(token, "other")).toBeNull();
    expect(await sharedAttachment("b".repeat(43), "img1")).toBeNull();
  });
});
