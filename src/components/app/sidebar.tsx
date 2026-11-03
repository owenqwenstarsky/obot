"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderOpen, PanelLeft, Search, Shapes, SquarePen, X, Zap } from "lucide-react";
import { openCommandPalette } from "@/components/app/command-palette";
import type { ReactNode } from "react";
import { useThreads } from "@/hooks/queries";
import { groupThreads } from "@/lib/thread-groups";
import { ThreadItem } from "@/components/app/thread-item";
import { UserMenu } from "@/components/app/user-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function Sidebar({ onCollapse, onNavigate }: { onCollapse: () => void; onNavigate?: () => void }) {
  const pathname = usePathname();
  const activeId = pathname.startsWith("/t/") ? pathname.slice(3).split("/")[0] : null;
  const { data: threads, isLoading } = useThreads();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (threads ?? []).filter((t) => !q || t.title.toLowerCase().includes(q));
    return groupThreads(list);
  }, [threads, query]);

  return (
    <div
      className="flex h-full flex-col bg-sidebar text-sidebar-foreground"
      onClick={(e) => {
        if (onNavigate && (e.target as HTMLElement).closest("a[href]")) onNavigate();
      }}
    >
      <div className="flex h-14 items-center justify-between px-3">
        <Link href="/" className="px-1 text-lg font-semibold tracking-tight">
          Obot
        </Link>
        <Button variant="ghost" size="icon" onClick={onCollapse} aria-label="Collapse sidebar">
          <PanelLeft />
        </Button>
      </div>

      <div className="space-y-2 px-3 pb-2">
        <Button asChild className="w-full justify-center" size="lg">
          <Link href="/">
            <SquarePen />
            New Thread
          </Link>
        </Button>
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={openCommandPalette}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-sm text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent/60"
          >
            <Search className="size-4" />
            Search
            <kbd className="ml-auto rounded border border-sidebar-border px-1.5 font-sans text-[10px] text-muted-foreground">⌘K</kbd>
          </button>
          <NavLink href="/projects" pathname={pathname} icon={<FolderOpen className="size-4" />} label="Projects" />
          <NavLink href="/artifacts" pathname={pathname} icon={<Shapes className="size-4" />} label="Artifacts" />
          <NavLink href="/prompts" pathname={pathname} icon={<Zap className="size-4" />} label="Prompts" />
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter threads…"
            className="h-8 w-full rounded-md border-b border-transparent bg-transparent pr-7 pl-8 text-sm outline-none placeholder:text-muted-foreground focus:border-sidebar-border"
          />
          {query && (
            <button
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-2">
        {isLoading && (
          <div className="space-y-2 px-2 pt-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        )}
        {!isLoading && groups.length === 0 && (
          <p className="px-3 pt-6 text-center text-xs text-muted-foreground">
            {query ? "No thread titles match. Press ⌘K to search messages too." : "No threads yet. Start one!"}
          </p>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            <div className="px-2 pt-2 pb-1 text-xs font-medium text-primary/90">{g.label}</div>
            <ul className="space-y-0.5">
              {g.items.map((t) => (
                <ThreadItem key={t.id} thread={t} active={t.id === activeId} activeId={activeId} />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <UserMenu />
      </div>
    </div>
  );
}

function NavLink({ href, pathname, icon, label }: { href: string; pathname: string; icon: ReactNode; label: string }) {
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "flex h-8 items-center gap-2 rounded-md px-2.5 text-sm transition-colors",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60",
      )}
    >
      {icon}
      {label}
    </Link>
  );
}
