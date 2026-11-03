"use client";

import { useEffect } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useLimits, type LimitsResponse } from "@/hooks/queries";
import { alertStorageKey, shouldNotify, type SpendAlertLevel } from "@/lib/spend-alerts";
import { formatUsd } from "@/lib/money";

const LABEL = { weekly: "weekly", monthly: "monthly" } as const;

function readSeen(key: string): SpendAlertLevel | null {
  try {
    const v = localStorage.getItem(key);
    return v === "warning" || v === "reached" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Toasts once per window period when spend crosses 80% of a cap, and again when it's reached.
 * Limits are refetched after every run, so this reacts as soon as a reply finishes.
 */
export function SpendAlerts() {
  const { data } = useLimits();
  useEffect(() => {
    if (!data || data.unlimited) return;
    for (const w of ["monthly", "weekly"] as const) {
      const win: LimitsResponse[typeof w] = data[w];
      if (!win.alert || win.limitMicros == null) continue;
      const key = alertStorageKey(w, win.resetsAt);
      if (!shouldNotify(readSeen(key), win.alert)) continue;
      try {
        localStorage.setItem(key, win.alert);
      } catch {
        // storage full or blocked: still show the toast once this session
      }
      const resets = format(new Date(win.resetsAt), "EEE d MMM, HH:mm");
      if (win.alert === "reached") {
        toast.error(`You've reached your ${LABEL[w]} spend limit`, {
          description: `${formatUsd(win.spentMicros)} of ${formatUsd(win.limitMicros)}. New replies are blocked until ${resets}.`,
          duration: 10_000,
        });
      } else {
        toast.warning(`You've used ${Math.floor((win.spentMicros / win.limitMicros) * 100)}% of your ${LABEL[w]} limit`, {
          description: `${formatUsd(win.spentMicros)} of ${formatUsd(win.limitMicros)}. Resets ${resets}.`,
          duration: 8_000,
        });
      }
      break; // one toast at a time; the other window will show on the next refresh if still relevant
    }
  }, [data]);
  return null;
}

/** The tightest window that is at or over the warning level, for inline hints. */
export function worstWindow(data: LimitsResponse | undefined) {
  if (!data || data.unlimited) return null;
  const rank = (a: SpendAlertLevel | null) => (a === "reached" ? 2 : a === "warning" ? 1 : 0);
  const candidates = (["weekly", "monthly"] as const)
    .map((w) => ({ window: w, ...data[w] }))
    .filter((x) => x.alert && x.limitMicros != null)
    .sort((a, b) => rank(b.alert) - rank(a.alert) || b.spentMicros / b.limitMicros! - a.spentMicros / a.limitMicros!);
  return candidates[0] ?? null;
}
