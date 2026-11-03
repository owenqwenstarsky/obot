"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Users, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { normalizeCommand } from "@/lib/slash";
import { usePrompts, type ClientPrompt } from "@/hooks/queries";
import { useShellUser } from "@/components/app/user-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Draft = { id: string | null; command: string; title: string; body: string; shared: boolean };
const empty: Draft = { id: null, command: "", title: "", body: "", shared: false };

function PromptDialog({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  const qc = useQueryClient();
  const user = useShellUser();
  const [d, setD] = useState<Draft>(draft ?? empty);
  const save = useMutation({
    mutationFn: () =>
      d.id
        ? api(`/api/prompts/${d.id}`, { method: "PATCH", json: { command: d.command, title: d.title || null, body: d.body } })
        : api("/api/prompts", { method: "POST", json: { command: d.command, title: d.title || null, body: d.body, shared: d.shared } }),
    onSuccess: () => {
      toast.success(d.id ? "Prompt saved" : "Prompt created");
      void qc.invalidateQueries({ queryKey: ["prompts"] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const command = normalizeCommand(d.command);
  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{d.id ? "Edit prompt" : "New prompt"}</DialogTitle>
          <DialogDescription>
            Type <span className="font-mono">/{command || "command"}</span> in the composer to insert it. Put{" "}
            <span className="font-mono">{"{{cursor}}"}</span> where the cursor should land.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (command && d.body.trim()) save.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pr-cmd">Command</Label>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-sm text-muted-foreground">/</span>
                <Input
                  id="pr-cmd"
                  value={d.command}
                  onChange={(e) => setD({ ...d, command: e.target.value })}
                  onBlur={() => setD((x) => ({ ...x, command: normalizeCommand(x.command) }))}
                  className="pl-5 font-mono"
                  maxLength={60}
                  autoFocus
                  placeholder="summarize"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-title">Title (optional)</Label>
              <Input id="pr-title" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} maxLength={100} placeholder="Summarize text" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-body">Prompt</Label>
            <Textarea
              id="pr-body"
              value={d.body}
              onChange={(e) => setD({ ...d, body: e.target.value })}
              rows={8}
              maxLength={20_000}
              placeholder={"Summarize the following in 5 bullet points:\n\n{{cursor}}"}
            />
          </div>
          {!d.id && user.role === "ADMIN" && (
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                <span className="font-medium">Share with everyone</span>
                <span className="block text-xs text-muted-foreground">Everyone on this instance can use it. Only admins can edit it.</span>
              </span>
              <Switch checked={d.shared} onCheckedChange={(v) => setD({ ...d, shared: v })} />
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!command || !d.body.trim() || save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PromptRow({ p, onEdit }: { p: ClientPrompt; onEdit: () => void }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api(`/api/prompts/${p.id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["prompts"] }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <li className="group flex items-start gap-3 py-3">
      <span className="mt-0.5 rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">/{p.command}</span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {p.title}
          {p.scope === "INSTANCE" && (
            <span className="inline-flex items-center gap-1 rounded-full border px-1.5 text-[10px] font-normal text-muted-foreground">
              <Users className="size-2.5" /> Shared
            </span>
          )}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs whitespace-pre-wrap text-muted-foreground">{p.body}</p>
      </div>
      {p.editable && (
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
          <Button size="icon" variant="ghost" className="size-7" aria-label="Edit prompt" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="size-7" aria-label="Delete prompt" onClick={() => remove.mutate()} disabled={remove.isPending}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </li>
  );
}

export function PromptLibrary() {
  const { data, isLoading } = usePrompts();
  const [draft, setDraft] = useState<Draft | null>(null);
  const mine = (data ?? []).filter((p) => p.scope === "USER");
  const shared = (data ?? []).filter((p) => p.scope === "INSTANCE");
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setDraft({ ...empty })}>
          <Plus /> New prompt
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : (data ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
          <Zap className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium">No prompts yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">Save prompts you use often, then type / in the composer to drop them in.</p>
          </div>
        </div>
      ) : (
        <>
          {[
            { label: "Your prompts", items: mine },
            { label: "Shared with everyone", items: shared },
          ]
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <Card key={g.label}>
                <CardContent>
                  <p className="text-xs font-medium text-muted-foreground">{g.label}</p>
                  <ul className="divide-y">
                    {g.items.map((p) => (
                      <PromptRow
                        key={p.id}
                        p={p}
                        onEdit={() => setDraft({ id: p.id, command: p.command, title: p.title, body: p.body, shared: p.scope === "INSTANCE" })}
                      />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
        </>
      )}
      {draft && <PromptDialog key={draft.id ?? "new"} draft={draft} onClose={() => setDraft(null)} />}
    </div>
  );
}
