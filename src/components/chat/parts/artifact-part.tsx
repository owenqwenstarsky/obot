"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import type { FunctionToolPart } from "@/lib/parts";
import { partialJsonString } from "@/lib/partial-json";
import { useArtifactPanel } from "@/components/artifacts/artifact-panel";
import { KIND_LABEL, KindIcon } from "@/components/artifacts/artifact-kind";
import type { ArtifactKindName } from "@/components/artifacts/artifact-frame";
import { cn } from "@/lib/utils";
import { isToolLive } from "./function-tool-part";

/** Card for create_artifact / update_artifact; opens the artifact in the side panel. */
export function ArtifactCard({ part }: { part: FunctionToolPart }) {
  const panel = useArtifactPanel();
  const live = isToolLive(part);
  const display = part.display?.kind === "artifact" ? part.display : null;
  const streamed = useMemo(() => {
    if (display) return null;
    const content = partialJsonString(part.argsText, "content") ?? "";
    return {
      title: partialJsonString(part.argsText, "title"),
      kind: (partialJsonString(part.argsText, "kind") as ArtifactKindName | null) ?? null,
      lines: content ? content.split("\n").length : 0,
    };
  }, [display, part.argsText]);

  const isUpdate = part.name === "update_artifact";
  const title = display?.title ?? streamed?.title ?? (isUpdate ? "Updating artifact" : "New artifact");
  const kind: ArtifactKindName = display?.artifactKind ?? streamed?.kind ?? "markdown";
  const failed = part.status === "failed" || part.status === "cancelled";

  const subtitle = display
    ? `${KIND_LABEL[kind]} · ${isUpdate ? `updated to v${display.version}` : display.version > 1 ? `v${display.version}` : "created"}`
    : failed
      ? part.status === "cancelled"
        ? "Cancelled"
        : (part.error?.replace(/^Error:\s*/, "").slice(0, 140) ?? "Failed")
      : `${isUpdate ? "Updating" : "Writing"}${streamed?.lines ? ` · ${streamed.lines} line${streamed.lines === 1 ? "" : "s"}` : "…"}`;

  const body = (
    <>
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/60",
          failed && "border-destructive/30 text-destructive",
        )}
      >
        {live ? (
          <Loader2 className="size-4 animate-spin text-primary" />
        ) : failed ? (
          <TriangleAlert className="size-4" />
        ) : (
          <KindIcon kind={kind} className="size-4 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className={cn("block truncate text-xs text-muted-foreground", live && "text-shimmer")}>{subtitle}</span>
      </span>
      {display && <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/art:translate-x-0.5" />}
    </>
  );

  const className =
    "group/art flex w-full max-w-md items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left shadow-xs transition-colors";

  if (!display) return <div className={className}>{body}</div>;
  if (panel) {
    return (
      <button
        type="button"
        onClick={() => panel.open(display.artifactId, display.version)}
        className={cn(className, "hover:border-primary/40", panel.openId === display.artifactId && "border-primary/50")}
      >
        {body}
      </button>
    );
  }
  return (
    <Link href={`/artifacts/${display.artifactId}`} className={cn(className, "hover:border-primary/40")}>
      {body}
    </Link>
  );
}
