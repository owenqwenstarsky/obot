"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Loader2, Pencil, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { formatTokens, formatUsd, microsToDollars } from "@/lib/money";
import { getModelMetadata } from "@/config/model-metadata";
import type { CatalogModel } from "@/server/llm/catalog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Price = {
  id: string;
  effectiveFrom: string;
  inputPerMMicros: number;
  cachedInputPerMMicros: number;
  cacheWritePerMMicros: number | null;
  outputPerMMicros: number;
  webSearchPer1kMicros: number;
  longContextThreshold: number | null;
  longContextInputMult: number | null;
  longContextOutputMult: number | null;
  createdBy?: string | null;
};

type AdminModel = CatalogModel & { price: Price | null };

export function AdminModels() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-models"],
    queryFn: () => api<{ syncedAt: string | null; models: AdminModel[] }>("/api/admin/models"),
  });
  const [editing, setEditing] = useState<AdminModel | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin-models"] });
    void qc.invalidateQueries({ queryKey: ["models"] });
  };

  const sync = useMutation({
    mutationFn: () => api<{ total: number; added: number }>("/api/admin/models/sync", { method: "POST" }),
    onSuccess: (r) => {
      toast.success(`Loaded ${r.total} models from CLIProxyAPI${r.added ? ` (${r.added} new)` : ""}`);
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api(`/api/admin/models/${encodeURIComponent(id)}`, { method: "PATCH", json: { enabled } }),
    onMutate: ({ id, enabled }) => {
      qc.setQueryData<{ syncedAt: string | null; models: AdminModel[] }>(["admin-models"], (old) =>
        old ? { ...old, models: old.models.map((m) => (m.id === id ? { ...m, enabled } : m)) } : old,
      );
    },
    onSettled: invalidate,
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">Models</CardTitle>
          <CardDescription>
            Loaded automatically from CLIProxyAPI <code className="text-xs">/v1/models</code>. Enable the ones people can use, and set prices so
            spend can be counted. {data?.syncedAt && <>Last synced {new Date(data.syncedAt).toLocaleString()}.</>}
          </CardDescription>
        </div>
        <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
          {sync.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
        </Button>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16 pl-6">On</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="hidden md:table-cell">Context</TableHead>
              <TableHead className="hidden sm:table-cell">Price (per 1M in / out)</TableHead>
              <TableHead className="pr-6" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center">
                  <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            )}
            {(data?.models ?? []).map((m) => (
              <TableRow key={m.id} className={!m.available ? "opacity-60" : undefined}>
                <TableCell className="pl-6">
                  <Switch checked={m.enabled} onCheckedChange={(v) => toggle.mutate({ id: m.id, enabled: v })} aria-label={`Enable ${m.displayName}`} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{m.displayName}</span>
                    {m.hasMetadata && (
                      <Badge variant="secondary" className="gap-1">
                        <BookOpen className="size-3" /> Metadata
                      </Badge>
                    )}
                    {!m.available && <Badge variant="outline">Not in last sync</Badge>}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">{m.id}</div>
                </TableCell>
                <TableCell className="hidden text-sm tabular-nums md:table-cell">{m.contextWindow ? formatTokens(m.contextWindow) : <span className="text-muted-foreground">Unknown</span>}</TableCell>
                <TableCell className="hidden text-sm tabular-nums sm:table-cell">
                  {m.price ? (
                    <>
                      {formatUsd(m.price.inputPerMMicros)} / {formatUsd(m.price.outputPerMMicros)}
                    </>
                  ) : (
                    <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">
                      Unpriced
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="pr-6 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                    <Pencil /> Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {data && data.models.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No models yet. Check that CLIProxyAPI is reachable, then click Sync now.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
      {editing && <ModelDialog model={editing} onClose={() => setEditing(null)} onSaved={invalidate} />}
    </Card>
  );
}

const d = (micros: number | null | undefined) => (micros == null ? "" : String(microsToDollars(micros)));

function ModelDialog({ model, onClose, onSaved }: { model: AdminModel; onClose: () => void; onSaved: () => void }) {
  const meta = getModelMetadata(model.id);
  const p = model.price;
  const [name, setName] = useState(model.displayName === (meta?.displayName ?? "") ? "" : model.displayName);
  const [ctx, setCtx] = useState("");
  const [price, setPrice] = useState({
    input: d(p?.inputPerMMicros),
    cachedInput: d(p?.cachedInputPerMMicros),
    cacheWrite: d(p?.cacheWritePerMMicros),
    output: d(p?.outputPerMMicros),
    webSearchPer1k: d(p?.webSearchPer1kMicros),
    longContextThreshold: p?.longContextThreshold != null ? String(p.longContextThreshold) : "",
    longContextInputMult: p?.longContextInputMult != null ? String(p.longContextInputMult) : "",
    longContextOutputMult: p?.longContextOutputMult != null ? String(p.longContextOutputMult) : "",
  });

  const history = useQuery({
    queryKey: ["model-prices", model.id],
    queryFn: () => api<{ prices: Price[] }>(`/api/admin/models/${encodeURIComponent(model.id)}/prices`).then((r) => r.prices),
  });

  const saveDetails = useMutation({
    mutationFn: () =>
      api(`/api/admin/models/${encodeURIComponent(model.id)}`, {
        method: "PATCH",
        json: { displayNameOverride: name.trim() || null, ...(ctx.trim() ? { contextWindowOverride: Number(ctx) } : {}) },
      }),
    onSuccess: () => {
      toast.success("Model updated");
      onSaved();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const required = [price.input, price.cachedInput, price.output];
  const priceInvalid =
    required.some((v) => v.trim() === "" || !Number.isFinite(Number(v)) || Number(v) < 0) ||
    [price.cacheWrite, price.webSearchPer1k, price.longContextThreshold, price.longContextInputMult, price.longContextOutputMult].some(
      (v) => v.trim() !== "" && !Number.isFinite(Number(v)),
    );

  const savePrice = useMutation({
    mutationFn: () =>
      api(`/api/admin/models/${encodeURIComponent(model.id)}/prices`, {
        method: "POST",
        json: {
          input: Number(price.input),
          cachedInput: Number(price.cachedInput),
          cacheWrite: num(price.cacheWrite),
          output: Number(price.output),
          webSearchPer1k: num(price.webSearchPer1k) ?? 0,
          longContextThreshold: num(price.longContextThreshold),
          longContextInputMult: num(price.longContextInputMult),
          longContextOutputMult: num(price.longContextOutputMult),
        },
      }),
    onSuccess: () => {
      toast.success("New price saved. It applies to requests from now on.");
      onSaved();
      void history.refetch();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const field = (key: keyof typeof price, label: string, placeholder = "") => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input inputMode="decimal" value={price[key]} placeholder={placeholder} onChange={(e) => setPrice((s) => ({ ...s, [key]: e.target.value }))} />
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{model.displayName}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{model.id}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="pricing" className="min-h-[26rem]">
          <TabsList>
            <TabsTrigger value="pricing">Pricing</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="history">Price history</TabsTrigger>
          </TabsList>

          <TabsContent value="pricing" className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">
              USD. Spend = API-reported tokens × these prices. Saving creates a new price row effective immediately; past usage keeps the price it was
              recorded with.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {field("input", "Input / 1M")}
              {field("cachedInput", "Cached input / 1M")}
              {field("cacheWrite", "Cache write / 1M", "Same as input")}
              {field("output", "Output / 1M")}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {field("webSearchPer1k", "Web search / 1K calls", "0")}
              {field("longContextThreshold", "Long-context above (tokens)", "None")}
              {field("longContextInputMult", "Long-context input ×", "1")}
              {field("longContextOutputMult", "Long-context output ×", "1")}
            </div>
            {meta && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                <span>
                  OpenAI list price (reference only): ${meta.referencePricing.input} in · ${meta.referencePricing.cachedInput} cached · $
                  {meta.referencePricing.output} out. {meta.longContextNote}
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    setPrice((s) => ({
                      ...s,
                      input: String(meta.referencePricing.input),
                      cachedInput: String(meta.referencePricing.cachedInput),
                      cacheWrite: String(meta.referencePricing.cacheWrite),
                      output: String(meta.referencePricing.output),
                      longContextThreshold: String(meta.longContextThresholdTokens),
                      longContextInputMult: "2",
                      longContextOutputMult: "1.5",
                    }))
                  }
                >
                  Fill in
                </Button>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => savePrice.mutate()} disabled={priceInvalid || savePrice.isPending}>
                Save new price
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="details" className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Display name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={meta?.displayName ?? model.displayName} />
            </div>
            <div className="space-y-1.5">
              <Label>Context window override (tokens)</Label>
              <Input inputMode="numeric" value={ctx} onChange={(e) => setCtx(e.target.value)} placeholder={model.contextWindow ? String(model.contextWindow) : "Unknown"} />
              <p className="text-xs text-muted-foreground">Used by the context indicator. Leave empty to keep the current value.</p>
            </div>
            {meta && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-muted/50 p-3 text-xs">
                <dt className="text-muted-foreground">Max input</dt>
                <dd>{formatTokens(meta.maxInputTokens)}</dd>
                <dt className="text-muted-foreground">Max output</dt>
                <dd>{formatTokens(meta.maxOutputTokens)}</dd>
                <dt className="text-muted-foreground">Knowledge cutoff</dt>
                <dd>{meta.knowledgeCutoff}</dd>
                <dt className="text-muted-foreground">Reasoning</dt>
                <dd>{meta.reasoningEfforts.join(", ")}</dd>
              </dl>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => saveDetails.mutate()} disabled={saveDetails.isPending || (ctx.trim() !== "" && !(Number(ctx) > 0))}>
                Save details
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="history" className="pt-2">
            <div className="scrollbar-thin max-h-72 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>From</TableHead>
                    <TableHead className="text-right">In</TableHead>
                    <TableHead className="text-right">Cached</TableHead>
                    <TableHead className="text-right">Out</TableHead>
                    <TableHead>By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(history.data ?? []).map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="text-xs">{new Date(h.effectiveFrom).toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsd(h.inputPerMMicros)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsd(h.cachedInputPerMMicros)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsd(h.outputPerMMicros)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{h.createdBy ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                  {history.data?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                        No prices set yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
