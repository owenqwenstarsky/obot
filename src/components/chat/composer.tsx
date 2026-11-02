"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Clock, ImagePlus, Loader2, Square, X, Zap } from "lucide-react";
import { toast } from "sonner";
import type { CatalogModel } from "@/server/llm/catalog";
import type { ContextSnapshot } from "@/lib/parts";
import type { PendingSteer } from "@/lib/run-events";
import { ApiError, errorMessage } from "@/lib/api";
import { ModelSelector } from "./model-selector";
import { WebSearchToggle } from "./web-search-toggle";
import { ContextIndicator } from "./context-indicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const MAX_IMAGES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

type PendingImage = {
  key: string;
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  attachment?: { id: string; mime: string };
};

export type ComposerSubmit = {
  text: string;
  attachments: { id: string; mime: string }[];
};

export function Composer({
  models,
  modelId,
  effort,
  webSearch,
  onModelChange,
  onWebSearchChange,
  onSubmit,
  onStop,
  onInterrupt,
  pendingSteers = [],
  running,
  sending,
  context,
  spentMicros,
  autoFocus,
}: {
  models: CatalogModel[];
  modelId: string | null;
  effort: string | null;
  webSearch: boolean;
  onModelChange: (modelId: string, effort: string | null) => void;
  onWebSearchChange: (enabled: boolean) => void;
  onSubmit: (input: ComposerSubmit) => Promise<boolean>;
  onStop: () => void;
  /** Abort the current generation only (sub-agents keep running), sending any typed text right away. */
  onInterrupt?: (input: ComposerSubmit) => Promise<boolean>;
  pendingSteers?: PendingSteer[];
  running: boolean;
  sending: boolean;
  context: ContextSnapshot | null;
  spentMicros: number;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const model = models.find((m) => m.id === modelId) ?? null;
  const visionOk = !!model?.supportsImageInput;

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  // Auto-grow textarea.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [text]);

  // Revoke object URLs on unmount.
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useEffect(() => () => imagesRef.current.forEach((i) => URL.revokeObjectURL(i.previewUrl)), []);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!visionOk) {
        toast.error("The selected model doesn't accept images.");
        return;
      }
      const room = MAX_IMAGES - images.length;
      const picked = files.filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, room));
      if (files.length > room) toast.error(`You can attach up to ${MAX_IMAGES} images.`);
      for (const file of picked) {
        if (file.size > MAX_BYTES) {
          toast.error(`${file.name} is larger than 10 MB.`);
          continue;
        }
        const key = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const previewUrl = URL.createObjectURL(file);
        setImages((prev) => [...prev, { key, previewUrl, status: "uploading" }]);
        const form = new FormData();
        form.append("file", file);
        try {
          const res = await fetch("/api/uploads", { method: "POST", body: form, credentials: "same-origin" });
          const data = await res.json();
          if (!res.ok) throw new ApiError(data.error ?? "Upload failed", res.status);
          setImages((prev) =>
            prev.map((i) => (i.key === key ? { ...i, status: "ready", attachment: { id: data.attachment.id, mime: data.attachment.mime } } : i)),
          );
        } catch (err) {
          toast.error(errorMessage(err));
          setImages((prev) => prev.filter((i) => i.key !== key));
          URL.revokeObjectURL(previewUrl);
        }
      }
    },
    [images.length, visionOk],
  );

  const uploading = images.some((i) => i.status === "uploading");
  // While a run is active, text-only messages are queued into it ("steering").
  const canSend = running
    ? !sending && !uploading && images.length === 0 && text.trim().length > 0
    : !sending && !uploading && !!modelId && (text.trim().length > 0 || images.length > 0);

  async function interrupt() {
    if (!onInterrupt || sending) return;
    const prevText = text;
    setText("");
    try {
      await onInterrupt({ text, attachments: [] });
    } catch (err) {
      setText(prevText);
      toast.error(errorMessage(err));
    }
  }

  async function submit() {
    if (!canSend) return;
    const payload: ComposerSubmit = {
      text,
      attachments: images.filter((i) => i.attachment).map((i) => i.attachment!),
    };
    const prevText = text;
    const prevImages = images;
    setText("");
    setImages([]);
    try {
      await onSubmit(payload);
      prevImages.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    } catch (err) {
      setText(prevText);
      setImages(prevImages);
      toast.error(errorMessage(err));
    }
  }

  return (
    <div
      className={cn(
        "relative rounded-2xl border bg-card shadow-sm transition-colors focus-within:border-ring/60",
        dragging && "border-primary ring-2 ring-primary/30",
      )}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {running && pendingSteers.length > 0 && (
        <div className="flex flex-col gap-1 px-3 pt-3">
          {pendingSteers.map((s) => (
            <div key={s.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5 shrink-0" />
              <span className="shrink-0 font-medium text-foreground/80">Queued</span>
              <span className="truncate">{s.text}</span>
            </div>
          ))}
        </div>
      )}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {images.map((img) => (
            <div key={img.key} className="group/img relative size-16 overflow-hidden rounded-lg border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
              <img src={img.previewUrl} alt="" className="size-full object-cover" />
              {img.status === "uploading" && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <Loader2 className="size-4 animate-spin" />
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(img.previewUrl);
                  setImages((prev) => prev.filter((i) => i.key !== img.key));
                }}
                className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-background/90 opacity-0 shadow transition-opacity group-hover/img:opacity-100"
                aria-label="Remove image"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
          if (files.length) {
            e.preventDefault();
            void addFiles(files);
          }
        }}
        rows={1}
        placeholder={
          models.length === 0
            ? "No models available yet"
            : running
              ? "Message the agent while it works…"
              : "Ask the agent anything…"
        }
        className="scrollbar-thin block max-h-[280px] min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
      />

      <div className="flex min-w-0 items-center gap-1 px-2 pb-2">
        <ModelSelector models={models} modelId={modelId} effort={effort} onChange={onModelChange} />
        <WebSearchToggle enabled={webSearch} supported={!!model?.supportsWebSearch} onChange={onWebSearchChange} />
        {visionOk && !running && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Attach images"
              >
                <ImagePlus className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Attach images</TooltipContent>
          </Tooltip>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ContextIndicator
            context={context}
            spentMicros={spentMicros}
            model={
              model
                ? {
                    displayName: model.displayName,
                    contextWindow: model.contextWindow,
                    maxOutputTokens: model.maxOutputTokens,
                    longContextThreshold: model.longContextThreshold,
                  }
                : null
            }
          />
          {running ? (
            <>
              {onInterrupt && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => void interrupt()}
                      className="flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={text.trim() ? "Interrupt and send now" : "Interrupt"}
                    >
                      <Zap className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {text.trim() ? "Interrupt & send now" : "Interrupt the current step"} (sub-agents keep running)
                  </TooltipContent>
                </Tooltip>
              )}
              {text.trim().length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => void submit()}
                      disabled={!canSend}
                      className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                      aria-label="Queue message"
                    >
                      <ArrowUp className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Send when the agent reaches its next step</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onStop}
                    className="flex size-9 items-center justify-center rounded-xl bg-foreground text-background transition-opacity hover:opacity-85"
                    aria-label="Stop"
                  >
                    <Square className="size-3.5 fill-current" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Stop everything, including sub-agents</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSend}
              className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              aria-label="Send"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
