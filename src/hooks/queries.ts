"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ClientThread } from "@/server/agent/serialize";
import type { CatalogModel } from "@/server/llm/catalog";

export type ThreadListItem = ClientThread & { running: boolean };

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

export function useModels() {
  return useQuery({
    queryKey: ["models"],
    queryFn: () => api<ModelsResponse>("/api/models"),
    staleTime: 60_000,
  });
}

export type LimitsResponse = {
  unlimited: boolean;
  source: "user" | "default";
  weekly: { spentMicros: number; limitMicros: number | null; resetsAt: string };
  monthly: { spentMicros: number; limitMicros: number | null; resetsAt: string };
};

export function useLimits() {
  return useQuery({ queryKey: ["limits"], queryFn: () => api<LimitsResponse>("/api/me/limits") });
}
