"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, FileText, Loader2, MessageSquare, SquarePen, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, errorMessage } from "@/lib/api";
import { EFFORT_LABELS, type AllowedEffort } from "@/lib/efforts";
import { useModels, useProject, type ClientProjectDetail } from "@/hooks/queries";
import { useMounted } from "@/hooks/use-mounted";
import { DOCUMENT_EXTENSIONS } from "@/server/uploads/document-type";
import { formatBytes } from "@/components/chat/parts/bash-part";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

type Form = {
  name: string;
  description: string;
  instructions: string;
  defaultModelId: string;
  defaultEffort: string;
  webSearch: "inherit" | "on" | "off";
};

function toForm(p: ClientProjectDetail): Form {
  return {
    name: p.name,
    description: p.description ?? "",
    instructions: p.instructions ?? "",
    defaultModelId: p.defaultModelId ?? "__none",
    defaultEffort: p.defaultEffort ?? "__auto",
    webSearch: p.webSearchDefault == null ? "inherit" : p.webSearchDefault ? "on" : "off",
  };
}

const DOC_ACCEPT = DOCUMENT_EXTENSIONS.map((e) => `.${e}`).join(",");

export function ProjectView({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const mounted = useMounted();
  const { data: project, isLoading, error } = useProject(projectId);
  const { data: modelsData } = useModels();
  const [form, setForm] = useState<Form | null>(null);
  const [uploading, setUploading] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the editable form from the loaded project
    if (project && !form) setForm(toForm(project));
  }, [project, form]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["project", projectId] });
    void qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const save = useMutation({
    mutationFn: (f: Form) =>
      api<{ project: ClientProjectDetail }>(`/api/projects/${projectId}`, {
        method: "PATCH",
        json: {
          name: f.name.trim(),
          description: f.description.trim() || null,
          instructions: f.instructions.trim() || null,
          defaultModelId: f.defaultModelId === "__none" ? null : f.defaultModelId,
          defaultEffort: f.defaultModelId === "__none" || f.defaultEffort === "__auto" ? null : f.defaultEffort,
          webSearchDefault: f.webSearch === "inherit" ? null : f.webSearch === "on",
        },
      }),
    onSuccess: ({ project: p }) => {
      toast.success("Project saved");
      qc.setQueryData(["project", projectId], p);
      setForm(toForm(p));
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["threads"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const removeFile = useMutation({
    mutationFn: (fileId: string) => api(`/api/projects/${projectId}/files?fileId=${encodeURIComponent(fileId)}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Project deleted");
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["threads"] });
      router.push("/projects");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  async function upload(files: File[]) {
    for (const file of files) {
      setUploading((n) => n + 1);
      const body = new FormData();
      body.append("file", file);
      try {
        const res = await fetch(`/api/projects/${projectId}/files`, { method: "POST", body, credentials: "same-origin" });
        const data = await res.json();
        if (!res.ok) throw new ApiError(data.error ?? "Upload failed", res.status);
      } catch (err) {
        toast.error(`${file.name}: ${errorMessage(err)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    refresh();
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-medium">Project not found</p>
        <Link href="/projects" className="text-sm text-primary hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }

  const models = modelsData?.models ?? [];
  const model = form ? models.find((m) => m.id === form.defaultModelId) : undefined;
  const dirty = !!(project && form && JSON.stringify(toForm(project)) !== JSON.stringify(form));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 pt-14 pb-12 sm:px-8">
        <Link href="/projects" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" /> Projects
        </Link>
        {isLoading || !project || !form ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
                {project.description && <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} aria-label="Delete project">
                  <Trash2 />
                </Button>
                <Button asChild>
                  <Link href={`/?project=${project.id}`}>
                    <SquarePen /> New thread
                  </Link>
                </Button>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Instructions</CardTitle>
                    <CardDescription>The agent follows these in every thread of this project.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Textarea
                      value={form.instructions}
                      onChange={(e) => set("instructions", e.target.value)}
                      rows={8}
                      maxLength={20_000}
                      placeholder="e.g. You're helping me write a grant proposal for a marine biology lab. Keep a formal tone and cite sources."
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="pname">Name</Label>
                        <Input id="pname" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={100} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pdesc">Description</Label>
                        <Input id="pdesc" value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label>Default model</Label>
                        <Select value={form.defaultModelId} onValueChange={(v) => setForm((f) => (f ? { ...f, defaultModelId: v, defaultEffort: "__auto" } : f))}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">Your default</SelectItem>
                            {models.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.displayName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Effort</Label>
                        <Select value={form.defaultEffort} onValueChange={(v) => set("defaultEffort", v)} disabled={!model?.supportsReasoning}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__auto">Model default</SelectItem>
                            {model?.efforts.map((e) => (
                              <SelectItem key={e} value={e}>
                                {EFFORT_LABELS[e as AllowedEffort]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Web search</Label>
                        <Select value={form.webSearch} onValueChange={(v) => set("webSearch", v as Form["webSearch"])}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inherit">Your default</SelectItem>
                            <SelectItem value="on">Start on</SelectItem>
                            <SelectItem value="off">Start off</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      {dirty && (
                        <Button variant="ghost" onClick={() => setForm(toForm(project))}>
                          Discard
                        </Button>
                      )}
                      <Button onClick={() => save.mutate(form)} disabled={!dirty || !form.name.trim() || save.isPending}>
                        Save
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Threads</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {project.threads.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No threads yet.{" "}
                        <Link href={`/?project=${project.id}`} className="text-primary hover:underline">
                          Start one
                        </Link>{" "}
                        or move an existing thread here from its menu in the sidebar.
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {project.threads.map((t) => (
                          <li key={t.id}>
                            <Link href={`/t/${t.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:text-primary">
                              <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate">{t.title}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {mounted ? formatDistanceToNow(new Date(t.lastMessageAt), { addSuffix: true }) : ""}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className="self-start">
                <CardHeader>
                  <CardTitle className="text-base">Reference files</CardTitle>
                  <CardDescription>
                    PDFs and text files the agent reads in every thread. They&apos;re also copied to the sandbox under /home/user/project.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {project.files.length > 0 && (
                    <ul className="space-y-1.5">
                      {project.files.map((f) => (
                        <li key={f.id} className="group flex items-center gap-2.5 rounded-lg border px-2.5 py-2">
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                          <a href={`/api/uploads/${f.id}`} className="min-w-0 flex-1 hover:underline">
                            <span className="block truncate text-sm">{f.fileName}</span>
                            <span className="block text-[11px] text-muted-foreground">
                              {formatBytes(f.size)}
                              {f.pageCount ? ` · ${f.pageCount} pages` : ""}
                              {f.textChars === 0 ? " · no text found" : ""}
                            </span>
                          </a>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => removeFile.mutate(f.id)}
                            disabled={removeFile.isPending}
                            aria-label={`Remove ${f.fileName}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()} disabled={uploading > 0}>
                    {uploading > 0 ? <Loader2 className="animate-spin" /> : <Upload />}
                    {uploading > 0 ? "Uploading…" : "Add files"}
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    hidden
                    accept={DOC_ACCEPT}
                    onChange={(e) => {
                      void upload(Array.from(e.target.files ?? []));
                      e.target.value = "";
                    }}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Up to 20 files, 10 MB each. Long files are shortened in the prompt; the full copy stays in the sandbox.
                  </p>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              Its threads are kept and move back to your main list. The project&apos;s instructions and files are removed.
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
    </div>
  );
}
