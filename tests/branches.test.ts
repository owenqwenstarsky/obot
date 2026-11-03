import { describe, expect, it } from "vitest";
import { activePath, branchInfo, childrenOf, compareGroup, deepestLeaf } from "@/lib/branches";

type N = { id: string; parentId: string | null; createdAt: string; compareGroupId?: string | null };
const n = (id: string, parentId: string | null, t: number, compareGroupId: string | null = null): N => ({
  id,
  parentId,
  createdAt: new Date(t * 1000).toISOString(),
  compareGroupId,
});

// u1 → a1 → u2 → a2
//            ↳ u2b → a2b → u3 → a3
//      ↳ a1b (regenerated)
const tree: N[] = [
  n("u1", null, 1),
  n("a1", "u1", 2),
  n("u2", "a1", 3),
  n("a2", "u2", 4),
  n("u2b", "a1", 5),
  n("a2b", "u2b", 6),
  n("a1b", "u1", 7),
  n("u3", "a2b", 8),
  n("a3", "u3", 9),
];

describe("message trees", () => {
  it("walks root → leaf", () => {
    expect(activePath(tree, "a2").map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(activePath(tree, "a3").map((m) => m.id)).toEqual(["u1", "a1", "u2b", "a2b", "u3", "a3"]);
    expect(activePath(tree, "a1b").map((m) => m.id)).toEqual(["u1", "a1b"]);
  });

  it("falls back to the newest message when the leaf is unknown", () => {
    expect(activePath(tree, null).map((m) => m.id)).toEqual(["u1", "a1", "u2b", "a2b", "u3", "a3"]);
    expect(activePath(tree, "missing").at(-1)?.id).toBe("a3");
    expect(activePath([], "x")).toEqual([]);
  });

  it("survives cycles in corrupt data", () => {
    const bad: N[] = [n("x", "y", 1), n("y", "x", 2)];
    expect(activePath(bad, "x").map((m) => m.id)).toEqual(["y", "x"]);
  });

  it("orders children by creation time", () => {
    expect(childrenOf(tree, "a1").map((m) => m.id)).toEqual(["u2", "u2b"]);
    expect(childrenOf(tree, null).map((m) => m.id)).toEqual(["u1"]);
  });

  it("follows the newest child down to a leaf", () => {
    expect(deepestLeaf(tree, "u2")).toBe("a2");
    expect(deepestLeaf(tree, "u2b")).toBe("a3");
    expect(deepestLeaf(tree, "u1")).toBe("a1b");
    expect(deepestLeaf(tree, "a3")).toBe("a3");
  });

  it("reports sibling positions", () => {
    expect(branchInfo(tree, tree.find((m) => m.id === "u2")!)).toEqual({ index: 1, total: 2, prevId: null, nextId: "u2b" });
    expect(branchInfo(tree, tree.find((m) => m.id === "u2b")!)).toEqual({ index: 2, total: 2, prevId: "u2", nextId: null });
    expect(branchInfo(tree, tree.find((m) => m.id === "a3")!)).toEqual({ index: 1, total: 1, prevId: null, nextId: null });
  });

  it("groups side-by-side comparison replies", () => {
    const t: N[] = [n("u", null, 1), n("a", "u", 2, "g1"), n("b", "u", 2.5, "g1"), n("c", "u", 3)];
    expect(compareGroup(t, t[1]).map((m) => m.id)).toEqual(["a", "b"]);
    expect(compareGroup(t, t[3]).map((m) => m.id)).toEqual(["c"]);
  });
});
