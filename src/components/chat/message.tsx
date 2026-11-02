"use client";

import { memo, useState } from "react";
import { Check, Copy, Pencil, RefreshCw, Square } from "lucide-react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import type { ClientMessage } from "@/server/agent/serialize";
import { partsToText, type UserImagePart } from "@/lib/parts";
import { effortLabel } from "@/lib/efforts";
import { formatTokens, formatUsd } from "@/lib/money";
import { PartsRenderer } from "./parts/registry";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconAction
      label={copied ? "Copied" : "Copy"}
      onClick={async () => {
        if (!(await copyText(text))) {
          toast.error("Couldn't copy. Your browser blocked clipboard access.");
          return;
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />}
    </IconAction>
  );
}

function IconAction({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 [&_svg]:size-3.5"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function UserMessageImpl({
  message,
  canEdit,
  onEdit,
}: {
  message: ClientMessage;
  canEdit: boolean;
  onEdit: (text: string) => Promise<void>;
}) {
  const text = partsToText(message.parts);
  const images = message.parts.filter((p): p is UserImagePart => p.type === "user_image");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);

  if (editing) {
    return (
      <div className="ml-auto w-full max-w-[85%] space-y-2">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          className="scrollbar-thin min-h-24 w-full resize-y rounded-2xl border bg-card px-4 py-3 text-[15px] outline-none focus:border-ring"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={saving || (!draft.trim() && images.length === 0)}
            onClick={async () => {
              setSaving(true);
              try {
                await onEdit(draft);
                setEditing(false);
              } finally {
                setSaving(false);
              }
            }}
          >
            Save & send
          </Button>
        </div>
        <p className="text-right text-xs text-muted-foreground">Replies after this message will be replaced.</p>
      </div>
    );
  }

  return (
    <div className="group/msg flex flex-col items-end gap-1">
      {images.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
          {images.map((img) => (
            <a key={img.id} href={`/api/uploads/${img.attachmentId}`} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element -- authenticated user uploads */}
              <img
                src={`/api/uploads/${img.attachmentId}`}
                alt="Attached image"
                className="max-h-56 max-w-64 rounded-xl border object-cover"
              />
            </a>
          ))}
        </div>
      )}
      {text && (
        <div className="max-w-[85%] rounded-2xl bg-secondary px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words text-secondary-foreground">
          {text}
        </div>
      )}
      <div className="flex gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
        {text && <CopyButton text={text} />}
        {canEdit && (
          <IconAction
            label="Edit"
            onClick={() => {
              setDraft(text);
              setEditing(true);
            }}
          >
            <Pencil />
          </IconAction>
        )}
      </div>
    </div>
  );
}

export const UserMessage = memo(UserMessageImpl);

function AssistantMessageImpl({
  message,
  modelName,
  canRegenerate,
  isLast,
  onRegenerate,
}: {
  message: ClientMessage;
  modelName: string | null;
  canRegenerate: boolean;
  isLast: boolean;
  onRegenerate: () => void;
}) {
  const streaming = message.status === "STREAMING";
  const text = partsToText(message.parts);
  const u = message.usage;

  return (
    <div className="group/msg">
      {streaming && message.parts.length === 0 ? (
        <div className="flex items-center gap-2 py-1 text-sm">
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </span>
          <span className="text-shimmer">Working</span>
        </div>
      ) : (
        <PartsRenderer parts={message.parts} streaming={streaming} />
      )}

      {!streaming && (
        <div
          className={cn(
            "mt-2 flex items-center gap-0.5 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100",
            isLast ? "opacity-100" : "opacity-0 pointer-coarse:opacity-100",
          )}
        >
          {text && <CopyButton text={text} />}
          {canRegenerate && (
            <IconAction label="Regenerate" onClick={onRegenerate}>
              <RefreshCw />
            </IconAction>
          )}
          {message.status === "STOPPED" && (
            <span className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Square className="size-2.5 fill-current" /> Stopped
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-2 cursor-default truncate text-xs text-muted-foreground">
                {[
                  modelName ?? message.modelId,
                  message.effort ? effortLabel(message.effort) : null,
                  u ? `${formatTokens(u.totalTokens)} tokens` : null,
                  u ? formatUsd(u.costMicros) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </TooltipTrigger>
            {u && (
              <TooltipContent className="text-xs">
                <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 tabular-nums">
                  <span>Input</span>
                  <span className="text-right">{u.inputTokens.toLocaleString()}</span>
                  <span>Cached input</span>
                  <span className="text-right">{u.cachedInputTokens.toLocaleString()}</span>
                  <span>Output</span>
                  <span className="text-right">{u.outputTokens.toLocaleString()}</span>
                  <span>Reasoning</span>
                  <span className="text-right">{u.reasoningTokens.toLocaleString()}</span>
                  <span>Search calls (billed)</span>
                  <span className="text-right">{u.webSearchCalls}</span>
                  <span>Cost</span>
                  <span className="text-right">{u.priced ? formatUsd(u.costMicros, { precise: true }) : "Unpriced"}</span>
                </div>
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      )}
    </div>
  );
}

export const AssistantMessage = memo(AssistantMessageImpl);
