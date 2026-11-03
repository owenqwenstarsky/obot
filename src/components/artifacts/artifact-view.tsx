"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Streamdown } from "streamdown";
import { code as codePlugin } from "@streamdown/code";
import { ArrowLeft, Check, Copy, Download, ExternalLink, Loader2, MessageSquare, MoreHorizontal, Pencil, Trash2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { artifactFileName } from "@/lib/artifact-srcdoc";
import { useArtifact, type ClientArtifact } from "@/hooks/use-artifacts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSidebarCollapsed } from "@/components/app/sidebar-state";
import { ArtifactFrame } from "./artifact-frame";
import { KIND_LABEL, KindIcon } from "./artifact-kind";

const codePlugins = { code: codePlugin };
const LANG = { markdown: "markdown", html: "html", react: "tsx" } as const;

function fenced(lang: string, content: string) {
  const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${lang}\n${content}\n${fence}`;
}

function IconButton({ label, onClick, children }: { label: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Header + preview/code body for one artifact. Used by the chat side panel and the full viewer. */
export function ArtifactView({
  artifactId,
  variant,
  initialVersion = null,
  onClose,
}: {
  artifactId: string;
  variant: "panel" | "page";
  initialVersion?: number | null;
  onClose?: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [version, setVersion] = useState<number | null>(initialVersion);
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [copied, setCopied] = useState(false);
  const sidebarCollapsed = useSidebarCollapsed();
  const { data: a, isLoading, error } = useArtifact(artifactId, version);
  const content = a?.version?.content ?? "";
  const codeMd = useMemo(() => (a ? fenced(LANG[a.kind], content) : ""), [a, content]);

  async function rename() {
    if (!a) return;
    const title = window.prompt("Rename artifact", a.title)?.trim();
    if (!title || title === a.title) return;
    try {
      await api(`/api/artifacts/${a.id}`, { method: "PATCH", json: { title } });
      void qc.invalidateQueries({ queryKey: ["artifact", a.id] });
      qc.setQueryData<ClientArtifact[]>(["artifacts"], (old) => old?.map((x) => (x.id === a.id ? { ...x, title } : x)));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function remove() {
    if (!a || !window.confirm(`Delete "${a.title}"? This can't be undone.`)) return;
    try {
      await api(`/api/artifacts/${a.id}`, { method: "DELETE" });
      qc.setQueryData<ClientArtifact[]>(["artifacts"], (old) => old?.filter((x) => x.id !== a.id));
      toast.success("Artifact deleted");
      if (variant === "page") router.push("/artifacts");
      else onClose?.();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  function download() {
    if (!a) return;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = artifactFileName(a.title, a.kind);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <p>{errorMessage(error)}</p>
        {onClose && (
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          "flex items-center gap-2 border-b px-3 py-2",
          // On the page, leave room for the shell's floating sidebar buttons when they're shown.
          variant === "page" && cn("min-h-[3.25rem] py-2 pr-3 pl-[5.5rem]", !sidebarCollapsed && "md:pl-3"),
        )}
      >
        {variant === "page" && (
          <IconButton label="All artifacts" onClick={() => router.push("/artifacts")}>
            <ArrowLeft />
          </IconButton>
        )}
        {a ? <KindIcon kind={a.kind} className="size-4 shrink-0 text-muted-foreground" /> : <Skeleton className="size-4" />}
        <div className="min-w-0 flex-1">
          {a ? (
            <h2 className={cn("truncate font-medium", variant === "page" ? "text-base" : "text-sm")}>{a.title}</h2>
          ) : (
            <Skeleton className="h-4 w-40" />
          )}
          {a && variant === "page" && (
            <p className="truncate text-xs text-muted-foreground">
              {KIND_LABEL[a.kind]}
              {a.threadTitle && (
                <>
                  {" · from "}
                  <Link href={`/t/${a.threadId}`} className="hover:text-foreground hover:underline">
                    {a.threadTitle}
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
        {a && a.versions.length > 1 && (
          <Select value={String(a.version?.version ?? a.currentVersion)} onValueChange={(v) => setVersion(Number(v))}>
            <SelectTrigger size="sm" className="h-8 w-auto gap-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {[...a.versions].reverse().map((v) => (
                <SelectItem key={v.version} value={String(v.version)} className="text-xs">
                  v{v.version}
                  {v.version === a.currentVersion ? " (latest)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {a?.status === "READY" && (
          <div className="flex rounded-lg bg-muted p-0.5 text-xs">
            {(["preview", "code"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-md px-2.5 py-1 capitalize transition-colors",
                  tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        {a?.status === "READY" && (
          <>
            <IconButton
              label={copied ? "Copied" : "Copy source"}
              onClick={async () => {
                if (await copyText(content)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } else toast.error("Couldn't copy.");
              }}
            >
              {copied ? <Check /> : <Copy />}
            </IconButton>
            <IconButton label="Download" onClick={download}>
              <Download />
            </IconButton>
          </>
        )}
        {variant === "panel" && a && (
          <IconButton label="Open full viewer" onClick={() => router.push(`/artifacts/${a.id}`)}>
            <ExternalLink />
          </IconButton>
        )}
        {variant === "page" && a && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/t/${a.threadId}`}>
                  <MessageSquare /> Open thread
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void rename()}>
                <Pencil /> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {onClose && (
          <IconButton label="Close" onClick={onClose}>
            <X />
          </IconButton>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {isLoading || !a ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : a.status === "GENERATING" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-shimmer text-sm font-medium">Generating…</p>
            <p className="max-w-xs text-xs text-muted-foreground">This page updates automatically when the artifact is ready.</p>
            <Link href={`/t/${a.threadId}`} className="text-xs text-primary hover:underline">
              Watch it in the thread
            </Link>
          </div>
        ) : a.status === "FAILED" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <TriangleAlert className="size-6 text-destructive" />
            <p className="text-sm font-medium">Generation failed</p>
            {a.error && <p className="max-w-sm text-xs text-muted-foreground">{a.error}</p>}
            <Link href={`/t/${a.threadId}`} className="text-xs text-primary hover:underline">
              Open the thread
            </Link>
          </div>
        ) : tab === "code" ? (
          <div className="scrollbar-thin h-full overflow-auto p-3 text-sm">
            <Streamdown mode="static" plugins={codePlugins} shikiTheme={["github-light", "github-dark"]} controls={false}>
              {codeMd}
            </Streamdown>
          </div>
        ) : (
          <ArtifactFrame kind={a.kind} content={content} className="h-full" />
        )}
      </div>
    </div>
  );
}
