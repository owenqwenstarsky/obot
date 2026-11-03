"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { EFFORT_LABELS, type AllowedEffort } from "@/lib/efforts";
import type { CatalogModel } from "@/server/llm/catalog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Entry = { modelId: string; description: string; defaultEffort: string };
type Settings = { subagentsEnabled: boolean; subagentMaxConcurrent: number; subagentMaxSteps: number };

/** Sub-agent settings and the model allowlist (with descriptions shown to the orchestrating model). */
export function AdminSubagents() {
  const qc = useQueryClient();
  const settingsQ = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api<{ settings: Settings }>("/api/admin/settings").then((r) => r.settings),
  });
  const allowQ = useQuery({
    queryKey: ["admin-subagent-models"],
    queryFn: () =>
      api<{ models: { modelId: string; description: string | null; defaultEffort: string | null }[] }>("/api/admin/subagent-models").then(
        (r) => r.models,
      ),
  });
  const modelsQ = useQuery({
    queryKey: ["admin-models"],
    queryFn: () => api<{ syncedAt: string | null; models: CatalogModel[] }>("/api/admin/models"),
  });
  const enabledModels = useMemo(() => (modelsQ.data?.models ?? []).filter((m) => m.enabled && m.available), [modelsQ.data]);
  const byId = useMemo(() => new Map((modelsQ.data?.models ?? []).map((m) => [m.id, m])), [modelsQ.data]);

  const [enabled, setEnabled] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState("4");
  const [maxSteps, setMaxSteps] = useState("30");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [adding, setAdding] = useState("");

  useEffect(() => {
    const s = settingsQ.data;
    if (!s) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed form from loaded settings
    setEnabled(s.subagentsEnabled);
    setMaxConcurrent(String(s.subagentMaxConcurrent));
    setMaxSteps(String(s.subagentMaxSteps));
  }, [settingsQ.data]);

  useEffect(() => {
    if (!allowQ.data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed editable allowlist
    setEntries(allowQ.data.map((m) => ({ modelId: m.modelId, description: m.description ?? "", defaultEffort: m.defaultEffort ?? "" })));
  }, [allowQ.data]);

  const intOk = (v: string, min: number, max: number) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;
  const valid = intOk(maxConcurrent, 1, 8) && intOk(maxSteps, 1, 200);

  const save = useMutation({
    mutationFn: async () => {
      await api("/api/admin/settings", {
        method: "PATCH",
        json: { subagentsEnabled: enabled, subagentMaxConcurrent: Number(maxConcurrent), subagentMaxSteps: Number(maxSteps) },
      });
      await api("/api/admin/subagent-models", {
        method: "PUT",
        json: {
          models: (entries ?? []).map((e) => ({
            modelId: e.modelId,
            description: e.description.trim() || null,
            defaultEffort: e.defaultEffort || null,
          })),
        },
      });
    },
    onSuccess: () => {
      toast.success("Sub-agent settings saved");
      void qc.invalidateQueries({ queryKey: ["admin-settings"] });
      void qc.invalidateQueries({ queryKey: ["admin-subagent-models"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!settingsQ.data || !entries) return null;
  const update = (i: number, patch: Partial<Entry>) => setEntries((es) => es!.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const move = (i: number, d: -1 | 1) =>
    setEntries((es) => {
      const next = es!.slice();
      const [x] = next.splice(i, 1);
      next.splice(i + d, 0, x);
      return next;
    });
  const addable = enabledModels.filter((m) => !entries.some((e) => e.modelId === m.id));

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="text-base">Sub-agents</CardTitle>
        <CardDescription>
          Lets the agent delegate parallel work to sub-agents that run in their own threads (nested under the parent in the sidebar). Their
          usage counts toward the user&apos;s spend.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <label className="flex items-center justify-between gap-4 text-sm">
          <span className="font-medium">Enable sub-agents</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </label>
        <div className="flex flex-wrap gap-4">
          <div className="space-y-1.5">
            <Label>Max running at once (per turn)</Label>
            <Input className="w-28" inputMode="numeric" value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Max steps per sub-agent</Label>
            <Input className="w-28" inputMode="numeric" value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <div>
            <Label>Allowed models</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Sub-agents can only run on these. The description is shown to the orchestrating model so it can pick the right one (e.g.
              &ldquo;fast and cheap, good for web research&rdquo;). The first model is the fallback default.
            </p>
          </div>
          {entries.length === 0 && (
            <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
              No models allowed yet. Sub-agents stay unavailable until you add at least one.
            </p>
          )}
          <ul className="space-y-2">
            {entries.map((e, i) => {
              const m = byId.get(e.modelId);
              return (
                <li key={e.modelId} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {m?.displayName ?? e.modelId}
                      {m && !(m.enabled && m.available) && <span className="ml-2 text-xs text-destructive">(not enabled)</span>}
                    </span>
                    {m?.supportsReasoning && (
                      <Select value={e.defaultEffort || "__default"} onValueChange={(v) => update(i, { defaultEffort: v === "__default" ? "" : v })}>
                        <SelectTrigger size="sm" className="w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default">Model default</SelectItem>
                          {m.efforts.map((ef) => (
                            <SelectItem key={ef} value={ef}>
                              {EFFORT_LABELS[ef as AllowedEffort]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button variant="ghost" size="icon" className="size-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={i === entries.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => setEntries((es) => es!.filter((_, j) => j !== i))}
                      aria-label="Remove"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <Input
                    value={e.description}
                    maxLength={500}
                    onChange={(ev) => update(i, { description: ev.target.value })}
                    placeholder={m?.description ?? "What this model is good at (optional)"}
                    className="text-sm"
                  />
                </li>
              );
            })}
          </ul>
          {addable.length > 0 && (
            <div className="flex items-center gap-2">
              <Select value={adding} onValueChange={setAdding}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Add a model…" />
                </SelectTrigger>
                <SelectContent>
                  {addable.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                disabled={!adding}
                onClick={() => {
                  setEntries((es) => [...es!, { modelId: adding, description: "", defaultEffort: "" }]);
                  setAdding("");
                }}
              >
                <Plus /> Add
              </Button>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>
            Save sub-agent settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
