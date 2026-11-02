/** Groups threads for the sidebar: Pinned / Today / Yesterday / Last 7 days / Last 30 days / Older. */
export type Groupable = { pinned: boolean; lastMessageAt: string };

export function groupThreads<T extends Groupable>(threads: T[], now = new Date()): { label: string; items: T[] }[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const groups: Record<string, T[]> = {
    Pinned: [],
    Today: [],
    Yesterday: [],
    "Last 7 days": [],
    "Last 30 days": [],
    Older: [],
  };
  for (const t of threads) {
    if (t.pinned) {
      groups.Pinned.push(t);
      continue;
    }
    const ts = new Date(t.lastMessageAt).getTime();
    if (ts >= startOfToday) groups.Today.push(t);
    else if (ts >= startOfToday - day) groups.Yesterday.push(t);
    else if (ts >= startOfToday - 7 * day) groups["Last 7 days"].push(t);
    else if (ts >= startOfToday - 30 * day) groups["Last 30 days"].push(t);
    else groups.Older.push(t);
  }
  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({
      label,
      items: items.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
    }));
}
