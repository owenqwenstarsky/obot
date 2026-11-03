"use client";

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ClientArtifact, ClientArtifactDetail } from "@/server/artifacts";

export type { ClientArtifact, ClientArtifactDetail };

const CACHE_KEY = "obot:artifacts-cache";

function readCache(): ClientArtifact[] | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { at: number; artifacts: ClientArtifact[] };
    return Array.isArray(parsed.artifacts) ? parsed.artifacts : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(artifacts: ClientArtifact[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), artifacts }));
  } catch {
    // storage full or unavailable
  }
}

/**
 * The artifact list. Seeds from the last list cached in localStorage so a refresh renders
 * immediately, then revalidates. While any artifact is generating, polls the batch status
 * endpoint for just those ids and merges the results.
 */
export function useArtifacts() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["artifacts"],
    queryFn: () => api<{ artifacts: ClientArtifact[] }>("/api/artifacts").then((r) => r.artifacts),
    initialData: () => (typeof window === "undefined" ? undefined : readCache()),
    initialDataUpdatedAt: 0,
    staleTime: 5_000,
  });

  const generatingIds = useMemo(
    () => (list.data ?? []).filter((a) => a.status === "GENERATING").map((a) => a.id),
    [list.data],
  );

  const status = useQuery({
    queryKey: ["artifacts-status", generatingIds.join(",")],
    queryFn: () =>
      api<{ artifacts: ClientArtifact[] }>(`/api/artifacts/status?ids=${encodeURIComponent(generatingIds.join(","))}`).then(
        (r) => r.artifacts,
      ),
    enabled: generatingIds.length > 0,
    refetchInterval: 2_500,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    const fresh = status.data;
    if (!fresh?.length) return;
    const byId = new Map(fresh.map((a) => [a.id, a]));
    let finished = false;
    qc.setQueryData<ClientArtifact[]>(["artifacts"], (old) =>
      old?.map((a) => {
        const n = byId.get(a.id);
        if (n && a.status === "GENERATING" && n.status !== "GENERATING") finished = true;
        return n ?? a;
      }),
    );
    if (finished) void qc.invalidateQueries({ queryKey: ["threads"] });
  }, [status.data, qc]);

  useEffect(() => {
    if (list.data) writeCache(list.data);
  }, [list.data]);

  return { ...list, generatingIds };
}

export function useArtifact(id: string | null, version: number | null) {
  return useQuery({
    queryKey: ["artifact", id, version],
    queryFn: () =>
      api<{ artifact: ClientArtifactDetail }>(`/api/artifacts/${id}${version ? `?version=${version}` : ""}`).then((r) => r.artifact),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === "GENERATING" ? 2_500 : false),
  });
}
