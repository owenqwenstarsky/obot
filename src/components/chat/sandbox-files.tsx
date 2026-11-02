"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, File, FolderClosed, FolderOpen } from "lucide-react";
import { api } from "@/lib/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBytes } from "./parts/bash-part";

type Entry = { path: string; size: number; isDir: boolean };

const HOME = "/home/user/";

/** Popover listing the thread's sandbox files with download links. Hidden when empty. */
export function SandboxFiles({ threadId, running }: { threadId: string; running: boolean }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["sandbox", threadId],
    queryFn: () => api<{ entries: Entry[] }>(`/api/threads/${threadId}/sandbox`).then((r) => r.entries),
    staleTime: 10_000,
  });
  const { refetch } = q;
  useEffect(() => {
    if (!running) void refetch();
  }, [running, refetch]);
  useEffect(() => {
    if (open) void refetch();
  }, [open, refetch]);

  const files = useMemo(() => (q.data ?? []).filter((e) => !e.isDir), [q.data]);
  if (files.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-8 items-center gap-1.5 rounded-lg border bg-background/80 px-2.5 text-xs text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
            >
              {open ? <FolderOpen className="size-3.5" /> : <FolderClosed className="size-3.5" />}
              Files
              <span className="rounded bg-muted px-1 text-[10px]">{files.length}</span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Sandbox files for this thread</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">Sandbox · /home/user</div>
        <ul className="scrollbar-thin max-h-80 overflow-y-auto py-1">
          {files.map((f) => {
            const rel = f.path.startsWith(HOME) ? f.path.slice(HOME.length) : f.path;
            return (
              <li key={f.path}>
                <a
                  href={`/api/threads/${threadId}/sandbox/file?path=${encodeURIComponent(f.path)}`}
                  className="group flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted"
                  download
                >
                  <File className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{rel}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(f.size)}</span>
                  <Download className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                </a>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
