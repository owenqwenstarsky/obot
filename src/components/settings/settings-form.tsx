"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Brain } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

type MeSettings = {
  webSearchDefault: boolean | null;
  defaultModelId: string | null;
  defaultEffort: string | null;
  aboutMe: string | null;
  responseStyle: string | null;
  memoryEnabled: boolean;
  memoryCount: number;
  instanceWebSearchDefault: boolean;
  instanceMemoryEnabled: boolean;
};

type MePatch = Partial<Omit<MeSettings, "instanceWebSearchDefault" | "instanceMemoryEnabled" | "memoryCount">> & { name?: string };

export function SettingsForm() {
  const user = useShellUser();
  const qc = useQueryClient();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const { data } = useQuery({ queryKey: ["me-settings"], queryFn: () => api<MeSettings>("/api/me/settings") });
  const { data: modelsData } = useModels();
  const [name, setName] = useState(user.name);
  const [aboutMe, setAboutMe] = useState("");
  const [responseStyle, setResponseStyle] = useState("");
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!data || seeded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed editable fields once from loaded settings
    setAboutMe(data.aboutMe ?? "");
    setResponseStyle(data.responseStyle ?? "");
    setSeeded(true);
  }, [data, seeded]);

  const instructionsDirty = !!data && (aboutMe.trim() !== (data.aboutMe ?? "") || responseStyle.trim() !== (data.responseStyle ?? ""));

  const save = useMutation({
    mutationFn: (patch: MePatch) =>
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
          <CardTitle className="text-base">Custom instructions</CardTitle>
          <CardDescription>Included in every thread so the agent knows who you are and how you like answers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="about-me">About you</Label>
            <Textarea
              id="about-me"
              value={aboutMe}
              onChange={(e) => setAboutMe(e.target.value)}
              maxLength={4000}
              rows={4}
              placeholder="e.g. I'm a backend engineer working mostly in Go and Postgres. I live in Berlin."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="response-style">How should the agent respond?</Label>
            <Textarea
              id="response-style"
              value={responseStyle}
              onChange={(e) => setResponseStyle(e.target.value)}
              maxLength={4000}
              rows={4}
              placeholder="e.g. Be concise. Use metric units. Show code before explanations."
            />
          </div>
          <div className="flex justify-end">
            <Button
              disabled={!instructionsDirty || save.isPending}
              onClick={() => save.mutate({ aboutMe: aboutMe.trim() || null, responseStyle: responseStyle.trim() || null })}
            >
              Save instructions
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Memory</CardTitle>
          <CardDescription>
            Let the agent remember useful facts about you across threads. You can review, edit, or delete everything it saves.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data && !data.instanceMemoryEnabled ? (
            <p className="text-sm text-muted-foreground">Memory is turned off on this instance by an admin.</p>
          ) : (
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                <span className="font-medium">Use memory</span>
                <span className="block text-xs text-muted-foreground">
                  When on, the agent can save memories and sees them in new replies. Turning it off keeps saved memories but stops using them.
                </span>
              </span>
              <Switch
                checked={!!data?.memoryEnabled}
                disabled={!data}
                onCheckedChange={(v) => save.mutate({ memoryEnabled: v })}
              />
            </label>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href="/memories">
              <Brain /> Manage memories{data ? ` (${data.memoryCount})` : ""}
            </Link>
          </Button>
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
