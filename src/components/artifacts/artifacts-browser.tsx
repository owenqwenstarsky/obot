"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Plus, Search, Shapes, TriangleAlert } from "lucide-react";
import { useArtifacts, type ClientArtifact } from "@/hooks/use-artifacts";
import { useMounted } from "@/hooks/use-mounted";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { KIND_LABEL, KindIcon } from "./artifact-kind";
import type { ArtifactKindName } from "./artifact-frame";
import { NewArtifactDialog } from "./new-artifact-dialog";

function groupByAge(items: ClientArtifact[], now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const groups: Record<string, ClientArtifact[]> = { "In progress": [], Today: [], "This week": [], "This month": [], Older: [] };
  for (const a of items) {
    if (a.status === "GENERATING") {
      groups["In progress"].push(a);
      continue;
    }
    const t = new Date(a.updatedAt).getTime();
    if (t >= startOfToday) groups.Today.push(a);
    else if (t >= startOfToday - 7 * day) groups["This week"].push(a);
    else if (t >= startOfToday - 30 * day) groups["This month"].push(a);
    else groups.Older.push(a);
  }
  return Object.entries(groups).filter(([, v]) => v.length > 0);
}

function ArtifactCardLink({ a }: { a: ClientArtifact }) {
  const generating = a.status === "GENERATING";
  const failed = a.status === "FAILED";
  return (
    <Link
      href={`/artifacts/${a.id}`}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60",
            failed && "border-destructive/30 text-destructive",
          )}
        >
          {generating ? (
            <Loader2 className="size-4 animate-spin text-primary" />
          ) : failed ? (
            <TriangleAlert className="size-4" />
          ) : (
            <KindIcon kind={a.kind} className="size-4 text-muted-foreground" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{a.title}</p>
          <p className={cn("mt-0.5 truncate text-xs text-muted-foreground", generating && "text-shimmer")}>
            {generating ? "Generating…" : failed ? (a.error ?? "Failed") : `${KIND_LABEL[a.kind]}${a.currentVersion > 1 ? ` · v${a.currentVersion}` : ""}`}
          </p>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{a.threadTitle ?? ""}</span>
        <span className="shrink-0">{formatDistanceToNow(new Date(a.updatedAt), { addSuffix: true })}</span>
      </div>
    </Link>
  );
}

export function ArtifactsBrowser() {
  const mounted = useMounted();
  const { data, isLoading } = useArtifacts();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ArtifactKindName | "all">("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data ?? []).filter((a) => (kind === "all" || a.kind === kind) && (!q || a.title.toLowerCase().includes(q)));
    return groupByAge(list);
  }, [data, query, kind]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search artifacts…"
            className="h-9 w-full rounded-lg border bg-background pr-3 pl-9 text-sm outline-none focus:border-ring"
          />
        </div>
        <div className="flex rounded-lg bg-muted p-0.5 text-xs">
          {(["all", "markdown", "html", "react"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "rounded-md px-2.5 py-1.5 transition-colors",
                kind === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k === "all" ? "All" : KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus /> New artifact
        </Button>
      </div>

      {!mounted || (isLoading && !data) ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <Shapes className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium">{data?.length ? "No matching artifacts" : "No artifacts yet"}</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Ask the agent for an artifact in any thread, or generate one here. Documents, HTML pages and React apps are saved with
              their full version history.
            </p>
          </div>
          {!data?.length && (
            <Button variant="outline" onClick={() => setDialogOpen(true)}>
              <Plus /> New artifact
            </Button>
          )}
        </div>
      ) : (
        groups.map(([label, items]) => (
          <section key={label} className="space-y-2">
            <h2 className="text-xs font-medium text-muted-foreground">{label}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((a) => (
                <ArtifactCardLink key={a.id} a={a} />
              ))}
            </div>
          </section>
        ))
      )}
      <NewArtifactDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
