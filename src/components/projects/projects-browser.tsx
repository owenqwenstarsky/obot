"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { FileText, FolderOpen, MessageSquare, Plus } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useProjects, type ClientProject } from "@/hooks/queries";
import { useMounted } from "@/hooks/use-mounted";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function ProjectCard({ p }: { p: ClientProject }) {
  const mounted = useMounted();
  return (
    <Link
      href={`/projects/${p.id}`}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60">
          <FolderOpen className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{p.name}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.description || "No description"}</p>
        </div>
      </div>
      <div className="mt-auto flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="size-3" /> {p.threadCount}
        </span>
        <span className="inline-flex items-center gap-1">
          <FileText className="size-3" /> {p.fileCount}
        </span>
        <span className="ml-auto">{mounted ? formatDistanceToNow(new Date(p.updatedAt), { addSuffix: true }) : ""}</span>
      </div>
    </Link>
  );
}

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api<{ project: ClientProject }>("/api/projects", {
        method: "POST",
        json: { name: name.trim(), description: description.trim() || null },
      }),
    onSuccess: ({ project }) => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      onOpenChange(false);
      setName("");
      setDescription("");
      router.push(`/projects/${project.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Group threads that share instructions, reference files, and a default model.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-desc">Description (optional)</Label>
            <Textarea id="project-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsBrowser() {
  const { data, isLoading } = useProjects();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus /> New project
        </Button>
      </div>
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
          <FolderOpen className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium">No projects yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              A project keeps related threads together with shared instructions and reference files the agent always sees.
            </p>
          </div>
          <Button variant="outline" onClick={() => setOpen(true)}>
            <Plus /> Create your first project
          </Button>
        </div>
      )}
      <NewProjectDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
