"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { microsToDollars } from "@/lib/money";
import { EFFORT_LABELS, type AllowedEffort } from "@/lib/efforts";
import { useModels } from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Settings = {
  defaultLimitMode: "LIMITED" | "UNLIMITED";
  defaultWeeklyLimitMicros: number | null;
  defaultMonthlyLimitMicros: number | null;
  unpricedModelPolicy: "BLOCK_LIMITED" | "FREE";
  webSearchDefault: boolean;
  webSearchContextSize: "low" | "medium" | "high";
  webSearchAllowedDomains: string[];
  titleModelId: string | null;
  titleEffort: string | null;
  systemPrompt: string | null;
  agentMaxSteps: number;
  sandboxEnabled: boolean;
  sandboxPythonEnabled: boolean;
  inlineUiEnabled: boolean;
  artifactsEnabled: boolean;
};

type Form = {
  defaultLimitMode: Settings["defaultLimitMode"];
  weekly: string;
  monthly: string;
  unpricedModelPolicy: Settings["unpricedModelPolicy"];
  webSearchDefault: boolean;
  webSearchContextSize: Settings["webSearchContextSize"];
  domains: string;
  titleModelId: string;
  titleEffort: string;
  systemPrompt: string;
  agentMaxSteps: string;
  sandboxEnabled: boolean;
  sandboxPythonEnabled: boolean;
  inlineUiEnabled: boolean;
  artifactsEnabled: boolean;
};

function toForm(s: Settings): Form {
  return {
    defaultLimitMode: s.defaultLimitMode,
    weekly: s.defaultWeeklyLimitMicros != null ? String(microsToDollars(s.defaultWeeklyLimitMicros)) : "",
    monthly: s.defaultMonthlyLimitMicros != null ? String(microsToDollars(s.defaultMonthlyLimitMicros)) : "",
    unpricedModelPolicy: s.unpricedModelPolicy,
    webSearchDefault: s.webSearchDefault,
    webSearchContextSize: s.webSearchContextSize as Form["webSearchContextSize"],
    domains: s.webSearchAllowedDomains.join("\n"),
    titleModelId: s.titleModelId ?? "__auto",
    titleEffort: s.titleEffort ?? "__auto",
    systemPrompt: s.systemPrompt ?? "",
    agentMaxSteps: String(s.agentMaxSteps),
    sandboxEnabled: s.sandboxEnabled,
    sandboxPythonEnabled: s.sandboxPythonEnabled,
    inlineUiEnabled: s.inlineUiEnabled,
    artifactsEnabled: s.artifactsEnabled,
  };
}

const intIn = (v: string, min: number, max: number) => /^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max;

export function AdminSettings() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-settings"], queryFn: () => api<{ settings: Settings }>("/api/admin/settings").then((r) => r.settings) });
  const { data: modelsData } = useModels();
  const [form, setForm] = useState<Form | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the editable form from loaded settings
    if (data) setForm(toForm(data));
  }, [data]);

  const money = (v: string) => (v.trim() === "" ? null : Number(v));
  const invalid =
    !form ||
    [form.weekly, form.monthly].some((v) => v.trim() !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0)) ||
    !intIn(form.agentMaxSteps, 1, 200);

  const save = useMutation({
    mutationFn: () => {
      const f = form!;
      return api("/api/admin/settings", {
        method: "PATCH",
        json: {
          defaultLimitMode: f.defaultLimitMode,
          defaultWeeklyLimit: money(f.weekly),
          defaultMonthlyLimit: money(f.monthly),
          unpricedModelPolicy: f.unpricedModelPolicy,
          webSearchDefault: f.webSearchDefault,
          webSearchContextSize: f.webSearchContextSize,
          webSearchAllowedDomains: f.domains.split(/[\n,]/).map((d) => d.trim()).filter(Boolean),
          titleModelId: f.titleModelId === "__auto" ? null : f.titleModelId,
          titleEffort: f.titleEffort === "__auto" ? null : f.titleEffort,
          systemPrompt: f.systemPrompt.trim() || null,
          agentMaxSteps: Number(f.agentMaxSteps),
          sandboxEnabled: f.sandboxEnabled,
          sandboxPythonEnabled: f.sandboxPythonEnabled,
          inlineUiEnabled: f.inlineUiEnabled,
          artifactsEnabled: f.artifactsEnabled,
        },
      });
    },
    onSuccess: () => {
      toast.success("Settings saved");
      void qc.invalidateQueries({ queryKey: ["admin-settings"] });
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
      void qc.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!form) return null;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const models = modelsData?.models ?? [];
  const titleModel = models.find((m) => m.id === form.titleModelId);

  return (
    <div className="grid max-w-3xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Default spend limits</CardTitle>
          <CardDescription>
            Applies to everyone set to &ldquo;Use instance default&rdquo;. Weeks reset Monday 00:00 UTC; months reset on the 1st at 00:00 UTC.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup value={form.defaultLimitMode} onValueChange={(v) => set("defaultLimitMode", v as Form["defaultLimitMode"])}>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="UNLIMITED" /> Unlimited by default
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="LIMITED" /> Limited by default
            </label>
          </RadioGroup>
          {form.defaultLimitMode === "LIMITED" && (
            <div className="grid max-w-md grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Weekly limit (USD)</Label>
                <Input inputMode="decimal" placeholder="No cap" value={form.weekly} onChange={(e) => set("weekly", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Monthly limit (USD)</Label>
                <Input inputMode="decimal" placeholder="No cap" value={form.monthly} onChange={(e) => set("monthly", e.target.value)} />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Models without a price</Label>
            <Select value={form.unpricedModelPolicy} onValueChange={(v) => set("unpricedModelPolicy", v as Form["unpricedModelPolicy"])}>
              <SelectTrigger className="w-full max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BLOCK_LIMITED">Block them for people with a spend limit</SelectItem>
                <SelectItem value="FREE">Allow them and count them as $0</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Web search</CardTitle>
          <CardDescription>Uses OpenAI&apos;s hosted web_search tool. People can override the default in their own settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              <span className="font-medium">On by default for new threads</span>
            </span>
            <Switch checked={form.webSearchDefault} onCheckedChange={(v) => set("webSearchDefault", v)} />
          </label>
          <div className="space-y-1.5">
            <Label>Search context size</Label>
            <Select value={form.webSearchContextSize} onValueChange={(v) => set("webSearchContextSize", v as Form["webSearchContextSize"])}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low (fastest, cheapest)</SelectItem>
                <SelectItem value="medium">Medium (balanced)</SelectItem>
                <SelectItem value="high">High (most context)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Allowed domains (optional)</Label>
            <Textarea
              rows={3}
              value={form.domains}
              onChange={(e) => set("domains", e.target.value)}
              placeholder={"Leave empty to search the whole web.\nOne domain per line, e.g. who.int"}
            />
            <p className="text-xs text-muted-foreground">Up to 100 domains. Subdomains are included automatically.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agent</CardTitle>
          <CardDescription>Thread titles are generated after the first message and count toward the user&apos;s spend.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1.5">
              <Label>Title model</Label>
              <Select value={form.titleModelId} onValueChange={(v) => set("titleModelId", v)}>
                <SelectTrigger className="w-60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto">Automatic (GPT-6 Luna if enabled)</SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Title reasoning</Label>
              <Select value={form.titleEffort} onValueChange={(v) => set("titleEffort", v)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto">Lowest available</SelectItem>
                  {(titleModel?.efforts ?? (["none", "low", "medium"] as AllowedEffort[])).map((e) => (
                    <SelectItem key={e} value={e}>
                      {EFFORT_LABELS[e as AllowedEffort]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>System prompt (optional)</Label>
            <Textarea
              rows={5}
              value={form.systemPrompt}
              onChange={(e) => set("systemPrompt", e.target.value)}
              placeholder="Instructions sent with every agent request, e.g. tone or formatting preferences."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Capabilities</CardTitle>
          <CardDescription>Local tools the agent can use. Changes apply to new turns.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Max steps per turn</Label>
            <Input
              className="w-32"
              inputMode="numeric"
              value={form.agentMaxSteps}
              onChange={(e) => set("agentMaxSteps", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Each model call counts as a step (1–200). Stops runaway tool loops.</p>
          </div>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              <span className="font-medium">Inline UI in replies</span>
              <span className="block text-xs text-muted-foreground">
                Lets the agent render cards, stats, callouts and tables in chat using the built-in UI kit (sanitized, no scripts).
              </span>
            </span>
            <Switch checked={form.inlineUiEnabled} onCheckedChange={(v) => set("inlineUiEnabled", v)} />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              <span className="font-medium">Artifacts</span>
              <span className="block text-xs text-muted-foreground">
                Saved markdown documents, HTML pages and React apps, created when people ask. React and HTML run in a sandboxed frame with no network.
              </span>
            </span>
            <Switch checked={form.artifactsEnabled} onCheckedChange={(v) => set("artifactsEnabled", v)} />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              <span className="font-medium">Bash sandbox</span>
              <span className="block text-xs text-muted-foreground">
                A lightweight in-memory shell per thread (just-bash). No network; files persist per thread.
              </span>
            </span>
            <Switch checked={form.sandboxEnabled} onCheckedChange={(v) => set("sandboxEnabled", v)} />
          </label>
          <label className="flex items-center justify-between gap-4 pl-4 text-sm">
            <span>
              <span className="font-medium">Python in the sandbox</span>
              <span className="block text-xs text-muted-foreground">
                CPython compiled to WebAssembly. Its memory use isn&apos;t capped, so turn this off on small servers.
              </span>
            </span>
            <Switch
              checked={form.sandboxPythonEnabled}
              disabled={!form.sandboxEnabled}
              onCheckedChange={(v) => set("sandboxPythonEnabled", v)}
            />
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" onClick={() => save.mutate()} disabled={invalid || save.isPending}>
          Save settings
        </Button>
      </div>
    </div>
  );
}
