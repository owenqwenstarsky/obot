"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Bot, Brain, FolderOpen, Loader2, MessageSquare, MessagesSquare, Search, Settings, Shapes, SquarePen, User, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { splitHighlights } from "@/lib/search-query";
import type { SearchResults } from "@/server/search";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const OPEN_PALETTE_EVENT = "obot:open-palette";

/** Open the palette from anywhere (e.g. the sidebar's search button). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

type Item = {
  key: string;
  section: "Actions" | "Threads" | "Messages";
  icon: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  href: string;
};

const ACTIONS: { label: string; href: string; icon: ReactNode; keywords: string }[] = [
  { label: "New thread", href: "/", icon: <SquarePen />, keywords: "new chat start" },
  { label: "Projects", href: "/projects", icon: <FolderOpen />, keywords: "folders" },
  { label: "Artifacts", href: "/artifacts", icon: <Shapes />, keywords: "documents apps" },
  { label: "Prompts", href: "/prompts", icon: <Zap />, keywords: "slash commands library templates" },
  { label: "Memories", href: "/memories", icon: <Brain />, keywords: "remember" },
  { label: "Usage", href: "/usage", icon: <BarChart3 />, keywords: "spend cost billing" },
  { label: "Settings", href: "/settings", icon: <Settings />, keywords: "preferences instructions" },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Snippet({ text }: { text: string }) {
  return (
    <>
      {splitHighlights(text).map((s, i) =>
        s.match ? (
          <mark key={i} className="rounded-sm bg-primary/20 px-0.5 text-foreground">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = useDebounced(query.trim(), 200);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["search", q],
    queryFn: ({ signal }) => api<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`, { signal }),
    enabled: open && q.length >= 2,
    staleTime: 10_000,
  });

  const items = useMemo<Item[]>(() => {
    const lower = query.trim().toLowerCase();
    const actions: Item[] = ACTIONS.filter((a) => !lower || `${a.label} ${a.keywords}`.toLowerCase().includes(lower)).map((a) => ({
      key: `a:${a.href}`,
      section: "Actions",
      icon: a.icon,
      label: a.label,
      href: a.href,
    }));
    if (q.length < 2 || !data) return actions;
    const threads: Item[] = data.threads.map((t) => ({
      key: `t:${t.id}`,
      section: "Threads",
      icon: <MessagesSquare />,
      label: t.title,
      hint: t.projectName ?? undefined,
      href: `/t/${t.id}`,
    }));
    const messages: Item[] = data.messages.map((m) => ({
      key: `m:${m.messageId}`,
      section: "Messages",
      icon: m.parentThreadId ? <Bot /> : m.role === "USER" ? <User /> : <MessageSquare />,
      label: <Snippet text={m.snippet || "…"} />,
      hint: m.threadTitle,
      href: `/t/${m.threadId}?m=${encodeURIComponent(m.messageId)}`,
    }));
    return [...actions.slice(0, 3), ...threads, ...messages];
  }, [data, q, query]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the highlighted row valid as results change
    setActive((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(item: Item | undefined) {
    if (!item) return;
    setOpen(false);
    setQuery("");
    router.push(item.href);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <DialogContent showCloseButton={false} className="top-[15vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search threads and messages, or jump to a page.</DialogDescription>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                go(items[active]);
              }
            }}
            placeholder="Search threads and messages…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Search"
          />
          {isFetching && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
        </div>
        <div ref={listRef} className="scrollbar-thin max-h-[60vh] overflow-y-auto p-1.5" role="listbox">
          {items.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {q.length >= 2 && !isFetching ? "No matches." : "Type to search."}
            </p>
          )}
          {items.map((item, i) => {
            const header = i === 0 || items[i - 1].section !== item.section ? item.section : null;
            return (
              <div key={item.key}>
                {header && <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(item)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground",
                    i === active && "bg-accent text-accent-foreground",
                  )}
                >
                  {item.icon}
                  <span className={cn("min-w-0 flex-1", item.section === "Messages" ? "line-clamp-2 text-[13px]" : "truncate")}>
                    {item.label}
                  </span>
                  {item.hint && <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">{item.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span>esc to close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
