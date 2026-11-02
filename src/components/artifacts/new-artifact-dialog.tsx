"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useModels, type ThreadListItem } from "@/hooks/queries";
import type { ClientArtifact, ClientArtifactDetail } from "@/hooks/use-artifacts";
import { resolveEffort, type AllowedEffort } from "@/lib/efforts";
import type { ClientThread } from "@/server/agent/serialize";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelector } from "@/components/chat/model-selector";
import { cn } from "@/lib/utils";
import { KIND_LABEL, KindIcon } from "./artifact-kind";
import type { ArtifactKindName } from "./artifact-frame";

const LAST_SELECTION_KEY = "obot:last-selection";

/**
 * Prompt for a new artifact. Generation runs in a new background thread; the dialog closes
 * immediately and the card on the Artifacts page tracks progress.
 */
export function NewArtifactDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const { data: modelsData } = useModels();
  const models = useMemo(() => (modelsData?.models ?? []).filter((m) => m.supportsFunctionTools), [modelsData]);
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<ArtifactKindName | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || modelId || models.length === 0) return;
    let last: { modelId?: string; effort?: string | null } = {};
    try {
      last = JSON.parse(localStorage.getItem(LAST_SELECTION_KEY) ?? "{}");
    } catch {
      // ignore
    }
    const m = models.find((x) => x.id === modelsData?.defaults.modelId) ?? models.find((x) => x.id === last.modelId) ?? models[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- choose a default model once models load
    setModelId(m.id);
    setEffort(
      m.supportsReasoning
        ? resolveEffort(last.modelId === m.id ? last.effort : null, m.efforts, (m.defaultEffort ?? undefined) as AllowedEffort | undefined)
        : null,
    );
  }, [open, models, modelId, modelsData]);

  async function submit() {
    if (!prompt.trim() || !modelId || submitting) return;
    setSubmitting(true);
    try {
      const res = await api<{ artifactId: string; threadId: string; thread: ClientThread; artifact: ClientArtifactDetail | null }>(
        "/api/artifacts/generate",
        { method: "POST", json: { prompt, modelId, effort, kind, webSearch: false } },
      );
      if (res.artifact) {
        const { versions: _v, version: _c, ...summary } = res.artifact;
        void _v;
        void _c;
        qc.setQueryData<ClientArtifact[]>(["artifacts"], (old) => [summary, ...(old ?? []).filter((a) => a.id !== summary.id)]);
      }
      qc.setQueryData<ThreadListItem[]>(["threads"], (old) => [
        { ...res.thread, running: true, children: [] },
        ...(old ?? []).filter((t) => t.id !== res.thread.id),
      ]);
      toast.success("Generating your artifact", { description: "It'll appear here when it's ready." });
      setPrompt("");
      setKind(null);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New artifact</DialogTitle>
          <DialogDescription>Describe what to make. It&apos;s generated in a new thread in the background.</DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="e.g. A one-page onboarding checklist for new engineers, or an interactive mortgage calculator"
          className="resize-none"
        />
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Format</p>
          <div className="flex flex-wrap gap-1.5">
            {([null, "markdown", "html", "react"] as const).map((k) => (
              <button
                key={k ?? "auto"}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                  kind === k ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k ? <KindIcon kind={k} className="size-3.5" /> : <Sparkles className="size-3.5" />}
                {k ? KIND_LABEL[k] : "Auto"}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <ModelSelector
            models={models}
            modelId={modelId}
            effort={effort}
            onChange={(id, e) => {
              setModelId(id);
              setEffort(e);
            }}
          />
          <Button onClick={() => void submit()} disabled={!prompt.trim() || !modelId || submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
