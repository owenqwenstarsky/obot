/**
 * Message trees (pure). Each message points at its parent; a thread's visible conversation
 * is the path from the root to its current leaf. Editing a user message or regenerating a
 * reply adds a sibling instead of deleting anything.
 */

export type TreeNode = {
  id: string;
  parentId: string | null;
  createdAt: string | Date;
  compareGroupId?: string | null;
};

const time = (n: TreeNode) => (typeof n.createdAt === "string" ? Date.parse(n.createdAt) : n.createdAt.getTime());

function byAge(a: TreeNode, b: TreeNode) {
  return time(a) - time(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Children of `parentId` (null = roots), oldest first. */
export function childrenOf<T extends TreeNode>(messages: T[], parentId: string | null): T[] {
  return messages.filter((m) => (m.parentId ?? null) === parentId).sort(byAge);
}

/** Root → leaf path. Falls back to the newest message when the leaf is unknown. */
export function activePath<T extends TreeNode>(messages: T[], leafId: string | null | undefined): T[] {
  if (messages.length === 0) return [];
  const byId = new Map(messages.map((m) => [m.id, m]));
  let cur = (leafId && byId.get(leafId)) || [...messages].sort(byAge).at(-1)!;
  const out: T[] = [];
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId)! : (undefined as unknown as T);
  }
  return out.reverse();
}

/** Follow the newest child from `fromId` down to a leaf. */
export function deepestLeaf<T extends TreeNode>(messages: T[], fromId: string): string {
  let id = fromId;
  const seen = new Set<string>();
  while (!seen.has(id)) {
    seen.add(id);
    const kids = childrenOf(messages, id);
    if (kids.length === 0) break;
    id = kids[kids.length - 1].id;
  }
  return id;
}

export type BranchInfo = { index: number; total: number; prevId: string | null; nextId: string | null };

/** Position of a message among its siblings (1-based index). */
export function branchInfo<T extends TreeNode>(messages: T[], message: T): BranchInfo {
  const siblings = childrenOf(messages, message.parentId ?? null);
  const i = siblings.findIndex((s) => s.id === message.id);
  return {
    index: i + 1,
    total: siblings.length,
    prevId: i > 0 ? siblings[i - 1].id : null,
    nextId: i >= 0 && i < siblings.length - 1 ? siblings[i + 1].id : null,
  };
}

/** The leaf to show after switching to `targetId` (a sibling of something on the path). */
export function leafForSwitch<T extends TreeNode>(messages: T[], targetId: string): string {
  return deepestLeaf(messages, targetId);
}

/**
 * Replies that were generated side by side (model comparison) with `message`: siblings that
 * share its compare group, oldest first. Returns just `[message]` when it isn't part of one.
 */
export function compareGroup<T extends TreeNode>(messages: T[], message: T): T[] {
  if (!message.compareGroupId) return [message];
  return childrenOf(messages, message.parentId ?? null).filter((m) => m.compareGroupId === message.compareGroupId);
}
