"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Check, Copy, FileJson, FileText, Link2, Loader2, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import type { ClientShare } from "@/server/shares";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Header menu: create/manage public share links and download exports. */
export function ShareMenu({ threadId, disabled }: { threadId: string; disabled?: boolean }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shares = useQuery({
    queryKey: ["shares", threadId],
    queryFn: () => api<{ shares: ClientShare[] }>(`/api/threads/${threadId}/shares`).then((r) => r.shares),
    enabled: dialogOpen,
  });

  const create = useMutation({
    mutationFn: () => api<{ url: string; share: ClientShare }>(`/api/threads/${threadId}/shares`, { method: "POST" }),
    onSuccess: async ({ url }) => {
      setCreatedUrl(url);
      setDialogOpen(true);
      void qc.invalidateQueries({ queryKey: ["shares", threadId] });
      if (await copyText(url)) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
        toast.success("Share link copied");
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/threads/${threadId}/shares/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Link revoked");
      void qc.invalidateQueries({ queryKey: ["shares", threadId] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          className="flex h-8 items-center gap-1.5 rounded-lg border bg-background/80 px-2.5 text-xs text-muted-foreground shadow-sm backdrop-blur hover:text-foreground disabled:opacity-50"
          aria-label="Share or export"
        >
          {create.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Share2 className="size-3.5" />}
          Share
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Share a read-only snapshot</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => create.mutate()} disabled={create.isPending}>
            <Link2 /> Create share link
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setCreatedUrl(null);
              setDialogOpen(true);
            }}
          >
            <Share2 /> Manage links…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Download</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <a href={`/api/threads/${threadId}/export?format=md`} download>
              <FileText /> Markdown (.md)
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/api/threads/${threadId}/export?format=json`} download>
              <FileJson /> JSON (.json)
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share links</DialogTitle>
            <DialogDescription>
              Anyone with a link can read the conversation as it was when the link was made, without signing in. New messages
              and other versions aren&apos;t included.
            </DialogDescription>
          </DialogHeader>
          {createdUrl && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium">New link (shown only once)</p>
              <div className="flex gap-2">
                <Input readOnly value={createdUrl} onFocus={(e) => e.currentTarget.select()} className="text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy link"
                  onClick={async () => {
                    if (await copyText(createdUrl)) {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }
                  }}
                >
                  {copied ? <Check /> : <Copy />}
                </Button>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Active links</p>
            {shares.isLoading ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : shares.data && shares.data.length > 0 ? (
              <ul className="divide-y rounded-lg border">
                {shares.data.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      Created {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}
                      <span className="text-muted-foreground"> · {s.messageCount} messages</span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label="Revoke link"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(s.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No active links.</p>
            )}
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => create.mutate()} disabled={create.isPending}>
              <Link2 /> Create new link
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
