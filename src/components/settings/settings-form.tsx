"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useModels } from "@/hooks/queries";
import { useMounted } from "@/hooks/use-mounted";
import { EFFORT_LABELS, type AllowedEffort } from "@/lib/efforts";
import { useShellUser } from "@/components/app/user-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

type MeSettings = {
  webSearchDefault: boolean | null;
  defaultModelId: string | null;
  defaultEffort: string | null;
  instanceWebSearchDefault: boolean;
};

export function SettingsForm() {
  const user = useShellUser();
  const qc = useQueryClient();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const { data } = useQuery({ queryKey: ["me-settings"], queryFn: () => api<MeSettings>("/api/me/settings") });
  const { data: modelsData } = useModels();
  const [name, setName] = useState(user.name);

  const save = useMutation({
    mutationFn: (patch: Partial<Omit<MeSettings, "instanceWebSearchDefault">> & { name?: string }) =>
      api("/api/me/settings", { method: "PATCH", json: patch }),
    onSuccess: () => {
      toast.success("Saved");
      router.refresh();
      void qc.invalidateQueries({ queryKey: ["me-settings"] });
      void qc.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const models = modelsData?.models ?? [];
  const defaultModel = models.find((m) => m.id === data?.defaultModelId);
  const wsValue = data?.webSearchDefault == null ? "inherit" : data.webSearchDefault ? "on" : "off";

  return (
    <div className="grid max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="name">Display name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </div>
          <Button disabled={!name.trim() || name === user.name} onClick={() => save.mutate({ name: name.trim() })}>
            Save
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Web search</CardTitle>
          <CardDescription>
            Whether the Search toggle starts on for new threads. You can still flip it per message, and each thread remembers its choice.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data && (
            <RadioGroup value={wsValue} onValueChange={(v) => save.mutate({ webSearchDefault: v === "inherit" ? null : v === "on" })}>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="inherit" /> Use instance default ({data.instanceWebSearchDefault ? "on" : "off"})
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="on" /> Always start on
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="off" /> Always start off
              </label>
            </RadioGroup>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Default model</CardTitle>
          <CardDescription>Used for new threads. If unset, Obot uses the last model you picked.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Select
            value={data?.defaultModelId ?? "__none"}
            onValueChange={(v) => save.mutate({ defaultModelId: v === "__none" ? null : v, defaultEffort: null })}
          >
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Last used</SelectItem>
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {defaultModel?.supportsReasoning && (
            <Select value={data?.defaultEffort ?? defaultModel.defaultEffort ?? undefined} onValueChange={(v) => save.mutate({ defaultEffort: v })}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Effort" />
              </SelectTrigger>
              <SelectContent>
                {defaultModel.efforts.map((e) => (
                  <SelectItem key={e} value={e}>
                    {EFFORT_LABELS[e as AllowedEffort]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={mounted ? (theme ?? "") : ""} onValueChange={setTheme} disabled={!mounted}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
    </div>
  );
}
