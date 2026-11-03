"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ThreadListEntry } from "@/server/agent/serialize";
import type { CatalogModel } from "@/server/llm/catalog";

export type ThreadListItem = ThreadListEntry;

export function useThreads() {
  return useQuery({
    queryKey: ["threads"],
    queryFn: () => api<{ threads: ThreadListItem[] }>("/api/threads").then((r) => r.threads),
    staleTime: 30_000,
  });
}

export type ModelsResponse = {
  models: CatalogModel[];
  defaults: { modelId: string | null; effort: string | null; webSearch: boolean };
};

export function useModels(enabled = true) {
  return useQuery({
    queryKey: ["models"],
    queryFn: () => api<ModelsResponse>("/api/models"),
    staleTime: 60_000,
    enabled,
  });
}

export type LimitWindow = {
  spentMicros: number;
  limitMicros: number | null;
  resetsAt: string;
  alert: "warning" | "reached" | null;
};

export type LimitsResponse = {
  unlimited: boolean;
  source: "user" | "default";
  weekly: LimitWindow;
  monthly: LimitWindow;
};

export function useLimits() {
  return useQuery({ queryKey: ["limits"], queryFn: () => api<LimitsResponse>("/api/me/limits") });
}

export type { ClientProject, ClientProjectDetail } from "@/server/projects";
import type { ClientProject, ClientProjectDetail } from "@/server/projects";

export function useProjects(enabled = true) {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ projects: ClientProject[] }>("/api/projects").then((r) => r.projects),
    staleTime: 30_000,
    enabled,
  });
}

export function useProject(id: string | null | undefined) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => api<{ project: ClientProjectDetail }>(`/api/projects/${id}`).then((r) => r.project),
    enabled: !!id,
  });
}

export type { ClientPrompt } from "@/server/prompts";
import type { ClientPrompt } from "@/server/prompts";

export function usePrompts(enabled = true) {
  return useQuery({
    queryKey: ["prompts"],
    queryFn: () => api<{ prompts: ClientPrompt[] }>("/api/prompts").then((r) => r.prompts),
    staleTime: 60_000,
    enabled,
  });
}
