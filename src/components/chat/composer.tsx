"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Clock, Columns2, FileText, Loader2, Paperclip, Square, X, Zap } from "lucide-react";
import { toast } from "sonner";
import type { CatalogModel } from "@/server/llm/catalog";
import type { ContextSnapshot } from "@/lib/parts";
import type { PendingSteer } from "@/lib/run-events";
import { ApiError, errorMessage } from "@/lib/api";
import { DOCUMENT_EXTENSIONS, MAX_ATTACHMENTS_PER_MESSAGE, MAX_UPLOAD_BYTES } from "@/server/uploads/document-type";
import type { ClientAttachment } from "@/server/agent/serialize";
import { formatBytes } from "./parts/bash-part";
import { usePrompts } from "@/hooks/queries";
import { expandPrompt, matchSlashCommands, slashQuery } from "@/lib/slash";
import Link from "next/link";
import { ModelSelector } from "./model-selector";
import { WebSearchToggle } from "./web-search-toggle";
import { ContextIndicator } from "./context-indicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const DOC_ACCEPT = DOCUMENT_EXTENSIONS.map((e) => `.${e}`).join(",");

type PendingAttachment = {
  key: string;
  /** "image" when the browser reports an image type; confirmed by the server on upload. */
  kind: "image" | "document";
  fileName: string;
  size: number;
  /** Blob URL for image previews. */
  previewUrl: string | null;
  status: "uploading" | "ready";
  attachment?: ClientAttachment;
};

export type ComposerSubmit = {
  text: string;
  attachments: ClientAttachment[];
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
  compare,
  onCompareChange,
  notice,
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
  /** Second model for a side-by-side comparison (null = off). Omit `onCompareChange` to hide the control. */
  compare?: { modelId: string; effort: string | null } | null;
  onCompareChange?: (next: { modelId: string; effort: string | null } | null) => void;
  /** A short line above the input (e.g. a spend warning). */
  notice?: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const model = models.find((m) => m.id === modelId) ?? null;
  const visionOk = !!model?.supportsImageInput;

  // ── `/` prompt library ──
  const query = running ? null : slashQuery(text);
  const { data: prompts } = usePrompts(query !== null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissedFor, setSlashDismissedFor] = useState<string | null>(null);
  const slashMatches = query !== null && prompts ? matchSlashCommands(query, prompts) : [];
  const slashOpen = query !== null && slashDismissedFor !== text && (slashMatches.length > 0 || (prompts?.length === 0 && query === ""));
  const activeSlash = Math.min(slashIndex, Math.max(0, slashMatches.length - 1));

  function applyPrompt(body: string) {
    const { text: next, cursor } = expandPrompt(body);
    setText(next);
    setSlashIndex(0);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

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
  useEffect(
    () => () =>
      imagesRef.current.forEach((i) => {
        if (i.previewUrl) URL.revokeObjectURL(i.previewUrl);
      }),
    [],
  );

  const removeAttachment = useCallback((key: string) => {
    setImages((prev) => {
      const hit = prev.find((i) => i.key === key);
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter((i) => i.key !== key);
    });
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      const room = MAX_ATTACHMENTS_PER_MESSAGE - images.length;
      if (files.length > room) toast.error(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
      for (const file of files.slice(0, Math.max(0, room))) {
        const isImage = file.type.startsWith("image/");
        if (isImage && !visionOk) {
          toast.error(`${file.name}: the selected model doesn't accept images.`);
          continue;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          toast.error(`${file.name} is larger than 10 MB.`);
          continue;
        }
        const key = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const previewUrl = isImage ? URL.createObjectURL(file) : null;
        setImages((prev) => [
          ...prev,
          { key, kind: isImage ? "image" : "document", fileName: file.name, size: file.size, previewUrl, status: "uploading" },
        ]);
        const form = new FormData();
        form.append("file", file);
        try {
          const res = await fetch("/api/uploads", { method: "POST", body: form, credentials: "same-origin" });
          const data = await res.json();
          if (!res.ok) throw new ApiError(data.error ?? "Upload failed", res.status);
          const attachment = data.attachment as ClientAttachment;
          if (attachment.kind === "IMAGE" && !visionOk) throw new Error("The selected model doesn't accept images.");
          setImages((prev) =>
            prev.map((i) =>
              i.key === key ? { ...i, kind: attachment.kind === "IMAGE" ? "image" : "document", status: "ready", attachment } : i,
            ),
          );
        } catch (err) {
          toast.error(`${file.name}: ${errorMessage(err)}`);
          removeAttachment(key);
        }
      }
    },
    [images.length, visionOk, removeAttachment],
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
      prevImages.forEach((i) => {
        if (i.previewUrl) URL.revokeObjectURL(i.previewUrl);
      });
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
      {notice && <div className="px-4 pt-2.5 text-xs">{notice}</div>}
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
          {images.map((img) =>
            img.previewUrl ? (
              <div key={img.key} className="group/img relative size-16 overflow-hidden rounded-lg border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                <img src={img.previewUrl} alt="" className="size-full object-cover" />
                {img.status === "uploading" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                    <Loader2 className="size-4 animate-spin" />
                  </div>
                )}
                <RemoveButton onClick={() => removeAttachment(img.key)} />
              </div>
            ) : (
              <div
                key={img.key}
                className="group/img relative flex h-16 max-w-56 min-w-40 items-center gap-2.5 rounded-lg border bg-muted/50 py-2 pr-7 pl-2.5"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background">
                  {img.status === "uploading" ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <FileText className="size-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium" title={img.fileName}>
                    {img.fileName}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {img.status === "uploading" ? "Uploading…" : documentMeta(img.attachment, img.size)}
                  </div>
                </div>
                <RemoveButton onClick={() => removeAttachment(img.key)} />
              </div>
            ),
          )}
        </div>
      )}

      {slashOpen && (
        <div
          className="absolute inset-x-2 bottom-full z-30 mb-2 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
          role="listbox"
          aria-label="Saved prompts"
        >
          {slashMatches.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-muted-foreground">
              No saved prompts yet.{" "}
              <Link href="/prompts" className="text-primary hover:underline">
                Create one
              </Link>
            </div>
          ) : (
            <ul className="scrollbar-thin max-h-64 overflow-y-auto p-1">
              {slashMatches.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === activeSlash}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => setSlashIndex(i)}
                    onClick={() => applyPrompt(p.body)}
                    className={cn(
                      "flex w-full items-baseline gap-2 rounded-md px-2.5 py-1.5 text-left text-sm",
                      i === activeSlash && "bg-accent text-accent-foreground",
                    )}
                  >
                    <span className="shrink-0 font-mono text-xs">/{p.command}</span>
                    <span className="min-w-0 flex-1 truncate">{p.title}</span>
                    {p.scope === "INSTANCE" && <span className="shrink-0 text-[10px] text-muted-foreground">shared</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">↑↓ to choose · ↵ or Tab to insert · Esc to close</div>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSlashIndex(0);
        }}
        onKeyDown={(e) => {
          if (slashOpen && !e.nativeEvent.isComposing) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const n = slashMatches.length;
              if (n) setSlashIndex((activeSlash + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
              return;
            }
            if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && slashMatches[activeSlash]) {
              e.preventDefault();
              applyPrompt(slashMatches[activeSlash].body);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setSlashDismissedFor(text);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
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
              : "Ask the agent anything… (type / for saved prompts)"
        }
        className="scrollbar-thin block max-h-[280px] min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
      />

      <div className="flex min-w-0 items-center gap-1 px-2 pb-2">
        <ModelSelector models={models} modelId={modelId} effort={effort} onChange={onModelChange} />
        <WebSearchToggle enabled={webSearch} supported={!!model?.supportsWebSearch} onChange={onWebSearchChange} />
        {onCompareChange && !running && models.length > 1 && (
          <>
            {compare ? (
              <span className="flex min-w-0 items-center rounded-lg bg-muted/60">
                <span className="pl-2 text-[11px] text-muted-foreground">vs</span>
                <ModelSelector
                  models={models}
                  modelId={compare.modelId}
                  effort={compare.effort}
                  onChange={(id, e) => onCompareChange({ modelId: id, effort: e })}
                />
                <button
                  type="button"
                  onClick={() => onCompareChange(null)}
                  className="mr-1 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label="Stop comparing"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      const other = models.find((m) => m.id !== modelId) ?? models[0];
                      onCompareChange({ modelId: other.id, effort: other.supportsReasoning ? (other.defaultEffort ?? null) : null });
                    }}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Compare models"
                  >
                    <Columns2 className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Compare with another model (side by side)</TooltipContent>
              </Tooltip>
            )}
          </>
        )}
        {!running && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Attach files"
              >
                <Paperclip className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{visionOk ? "Attach images, PDFs, or text files" : "Attach PDFs or text files"}</TooltipContent>
          </Tooltip>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={visionOk ? `${IMAGE_ACCEPT},${DOC_ACCEPT}` : DOC_ACCEPT}
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

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-background/90 opacity-0 shadow transition-opacity group-hover/img:opacity-100 focus-visible:opacity-100"
      aria-label="Remove attachment"
    >
      <X className="size-3" />
    </button>
  );
}

function documentMeta(att: ClientAttachment | undefined, size: number): string {
  const parts = [formatBytes(att?.size ?? size)];
  if (att?.pageCount) parts.push(`${att.pageCount} page${att.pageCount === 1 ? "" : "s"}`);
  if (att && att.textChars === 0) parts.push("no text found");
  return parts.join(" · ");
}
