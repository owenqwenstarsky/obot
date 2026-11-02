"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import type { ThreadListItem } from "@/hooks/queries";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function ThreadItem({ thread, active }: { thread: ThreadListItem; active: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const patch = useMutation({
    mutationFn: (body: { title?: string; pinned?: boolean }) =>
      api(`/api/threads/${thread.id}`, { method: "PATCH", json: body }),
    onMutate: (body) => {
      qc.setQueryData<ThreadListItem[]>(["threads"], (old) =>
        old?.map((t) => (t.id === thread.id ? { ...t, ...body } : t)),
      );
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      void qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/threads/${thread.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.setQueryData<ThreadListItem[]>(["threads"], (old) => old?.filter((t) => t.id !== thread.id));
      if (active) router.push("/");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  function startRename() {
    setTitle(thread.title);
    setRenaming(true);
  }

  function commitRename() {
    setRenaming(false);
    const next = title.trim();
    if (next && next !== thread.title) patch.mutate({ title: next });
    else setTitle(thread.title);
  }

  return (
    <li className="group/thread relative">
      {renaming ? (
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setTitle(thread.title);
              setRenaming(false);
            }
          }}
          className="h-8 w-full rounded-md border border-ring bg-background px-2 text-sm outline-none"
          maxLength={120}
        />
      ) : (
        <Link
          href={`/t/${thread.id}`}
          onDoubleClick={startRename}
          className={cn(
            "flex h-8 items-center gap-2 rounded-md px-2 pr-8 text-sm transition-colors",
            active
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
          )}
          title={thread.title}
        >
          {thread.running && (
            <span className="relative flex size-2 shrink-0" aria-label="Agent running">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
          )}
          <span className="truncate">{thread.title}</span>
        </Link>
      )}

      {!renaming && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background/60 hover:text-foreground group-hover/thread:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100",
            )}
            aria-label="Thread actions"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" className="w-40">
            <DropdownMenuItem onSelect={startRename}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => patch.mutate({ pinned: !thread.pinned })}>
              {thread.pinned ? (
                <>
                  <PinOff /> Unpin
                </>
              ) : (
                <>
                  <Pin /> Pin
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this thread?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{thread.title}&rdquo; will be removed from your threads. Your usage history is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
