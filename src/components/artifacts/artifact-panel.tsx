"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ArtifactView } from "./artifact-view";

type OpenArtifact = { id: string; version: number | null; key: number };

type PanelApi = { open: (id: string, version?: number | null) => void; openId: string | null };

const ArtifactPanelContext = createContext<PanelApi | null>(null);

/** Lets chat parts open an artifact in the side panel (no-op outside a chat view). */
export function useArtifactPanel(): PanelApi | null {
  return useContext(ArtifactPanelContext);
}

const WIDTH_KEY = "obot:artifact-panel-width";
const MIN_WIDTH = 360;

function ResizableSide({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState(560);
  const dragging = useRef(false);

  useEffect(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore persisted width after mount
    if (saved >= MIN_WIDTH) setWidth(saved);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const right = e.currentTarget.parentElement?.parentElement?.getBoundingClientRect().right ?? window.innerWidth;
    const max = Math.max(MIN_WIDTH, window.innerWidth * 0.72);
    setWidth(Math.min(max, Math.max(MIN_WIDTH, right - e.clientX)));
  };
  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    setWidth((w) => {
      localStorage.setItem(WIDTH_KEY, String(Math.round(w)));
      return w;
    });
  };

  return (
    <aside className="relative flex h-full shrink-0 flex-col border-l bg-background" style={{ width }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize artifact panel"
        className="absolute inset-y-0 -left-1.5 z-30 w-3 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-primary/50"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {children}
    </aside>
  );
}

/** Wraps the chat with an artifact side panel (desktop) or sheet (mobile). */
export function ArtifactPanelHost({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<OpenArtifact | null>(null);
  const desktop = useMediaQuery("(min-width: 1024px)", true);
  const open = useCallback((id: string, version: number | null = null) => setCurrent({ id, version, key: Date.now() }), []);
  const close = useCallback(() => setCurrent(null), []);
  const view = current ? (
    <ArtifactView key={current.key} artifactId={current.id} initialVersion={current.version} variant="panel" onClose={close} />
  ) : null;

  return (
    <ArtifactPanelContext.Provider value={{ open, openId: current?.id ?? null }}>
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        {current && desktop && <ResizableSide>{view}</ResizableSide>}
      </div>
      {!desktop && (
        <Sheet open={!!current} onOpenChange={(o) => !o && close()}>
          <SheetContent side="right" className="w-full p-0 sm:max-w-full" showCloseButton={false}>
            <SheetTitle className="sr-only">Artifact</SheetTitle>
            {view}
          </SheetContent>
        </Sheet>
      )}
    </ArtifactPanelContext.Provider>
  );
}
