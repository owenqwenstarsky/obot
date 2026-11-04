"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bot, Brain, Check, Pencil, Plus, Trash2, User, X } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useMounted } from "@/hooks/use-mounted";
import type { ClientMemory } from "@/server/memories";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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

type MeSettings = { memoryEnabled: boolean; instanceMemoryEnabled: boolean };

function MemoryRow({ m }: { m: ClientMemory }) {
  const qc = useQueryClient();
  const mounted = useMounted();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["memories"] });
    void qc.invalidateQueries({ queryKey: ["me-settings"] });
  };
  const save = useMutation({
    mutationFn: () => api(`/api/me/memories/${m.id}`, { method: "PATCH", json: { content: draft } }),
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/me/memories/${m.id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <li className="group flex items-start gap-3 py-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted" title={m.source === "AGENT" ? "Saved by the agent" : "Added by you"}>
        {m.source === "AGENT" ? <Bot className="size-3.5 text-muted-foreground" /> : <User className="size-3.5 text-muted-foreground" />}
      </span>
      {editing ? (
        <div className="flex-1 space-y-2">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} rows={2} autoFocus />
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              <X /> Cancel
            </Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={!draft.trim() || save.isPending}>
              <Check /> Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-relaxed break-words">{m.content}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {mounted ? formatDistanceToNow(new Date(m.updatedAt), { addSuffix: true }) : ""}
              {m.threadId && (
                <>
                  {" · "}
                  <Link href={`/t/${m.threadId}`} className="hover:underline">
                    from a thread
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Edit memory"
              onClick={() => {
                setDraft(m.content);
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="size-7" aria-label="Delete memory" onClick={() => remove.mutate()} disabled={remove.isPending}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </>
      )}
    </li>
  );
}

export function MemoriesManager() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["memories"],
    queryFn: () => api<{ memories: ClientMemory[] }>("/api/me/memories").then((r) => r.memories),
  });
  const { data: settings } = useQuery({ queryKey: ["me-settings"], queryFn: () => api<MeSettings>("/api/me/settings") });
  const [draft, setDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["memories"] });
    void qc.invalidateQueries({ queryKey: ["me-settings"] });
  };
  const add = useMutation({
    mutationFn: () => api("/api/me/memories", { method: "POST", json: { content: draft } }),
    onSuccess: () => {
      setDraft("");
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const clear = useMutation({
    mutationFn: () => api("/api/me/memories", { method: "DELETE" }),
    onSuccess: () => {
      toast.success("All memories deleted");
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const off = settings && (!settings.instanceMemoryEnabled || !settings.memoryEnabled);

  return (
    <div className="max-w-3xl space-y-4">
      {off && (
        <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          {settings.instanceMemoryEnabled ? (
            <>
              Memory is off, so the agent doesn&apos;t use or save these.{" "}
              <Link href="/settings" className="text-primary hover:underline">
                Turn it on in Settings
              </Link>
              .
            </>
          ) : (
            "Memory is turned off on this instance by an admin, so these aren't used."
          )}
        </div>
      )}
      <Card>
        <CardContent className="space-y-2">
          <form
            className="flex items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) add.mutate();
            }}
          >
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={1000}
              rows={1}
              placeholder="Add something for the agent to remember…"
              className="min-h-9 flex-1 resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (draft.trim()) add.mutate();
                }
              }}
            />
            <Button type="submit" disabled={!draft.trim() || add.isPending}>
              <Plus /> Add
            </Button>
          </form>
          {isLoading ? (
            <div className="space-y-2 pt-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : data && data.length > 0 ? (
            <ul className="divide-y">
              {data.map((m) => (
                <MemoryRow key={`${m.id}:${m.updatedAt}`} m={m} />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <Brain className="size-6" />
              Nothing saved yet. Ask the agent to remember something, or add it here.
            </div>
          )}
        </CardContent>
      </Card>
      {data && data.length > 0 && (
        <div className="flex justify-end">
          <Button variant="ghost" className="text-destructive" onClick={() => setConfirmClear(true)}>
            <Trash2 /> Delete all memories
          </Button>
        </div>
      )}
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all memories?</AlertDialogTitle>
            <AlertDialogDescription>The agent will forget everything it saved about you. This can&apos;t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => clear.mutate()}>
              Delete all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
