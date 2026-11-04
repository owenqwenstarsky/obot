"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { TriangleAlert } from "lucide-react";
import { buildArtifactSrcDoc } from "@/lib/artifact-srcdoc";
import { useMounted } from "@/hooks/use-mounted";
import { InlineUiRenderer } from "@/components/chat/inline-ui/inline-ui";
import { cn } from "@/lib/utils";
import { stripCitationMarkers } from "@/lib/citations";

const mdPlugins = { code, renderers: [{ language: "ui", component: InlineUiRenderer }] };

export type ArtifactKindName = "markdown" | "html" | "react";

/**
 * Renders an artifact. HTML and React run in a sandboxed iframe (scripts allowed, opaque
 * origin, strict CSP, no network). Markdown renders in-app.
 */
export function ArtifactFrame({ kind, content, className }: { kind: ArtifactKindName; content: string; className?: string }) {
  const { resolvedTheme } = useTheme();
  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";
  const mounted = useMounted();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  // The theme is baked into the document (and also pushed via postMessage while loading).
  const srcDoc = useMemo(() => {
    if (!mounted || kind === "markdown") return "";
    return buildArtifactSrcDoc(kind, content, window.location.origin, theme);
  }, [mounted, kind, content, theme]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset error when content changes
    setError(null);
  }, [srcDoc]);

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ type: "obot:theme", theme }, "*");
  }, [theme]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data as { source?: string; type?: string; message?: string } | null;
      if (d?.source !== "obot-artifact") return;
      if (d.type === "error" && d.message) setError(d.message);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (kind === "markdown") {
    return (
      <div className={cn("scrollbar-thin overflow-y-auto", className)}>
        <div className="prose-obot mx-auto max-w-3xl px-6 py-6">
          <Streamdown mode="static" plugins={mdPlugins} linkSafety={{ enabled: false }} shikiTheme={["github-light", "github-dark"]}>
            {stripCitationMarkers(content)}
          </Streamdown>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative flex flex-col", className)}>
      {mounted && (
        <iframe
          ref={frameRef}
          title="Artifact preview"
          sandbox="allow-scripts allow-modals allow-popups allow-downloads"
          srcDoc={srcDoc}
          className="min-h-0 w-full flex-1 border-0 bg-white dark:bg-neutral-950"
          onLoad={() => frameRef.current?.contentWindow?.postMessage({ type: "obot:theme", theme }, "*")}
        />
      )}
      {error && (
        <div className="absolute inset-x-3 bottom-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-background/95 px-3 py-2 text-xs text-destructive shadow-md backdrop-blur">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          <span className="line-clamp-3 font-mono">{error}</span>
        </div>
      )}
    </div>
  );
}
