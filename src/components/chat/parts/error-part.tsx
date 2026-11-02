import { TriangleAlert } from "lucide-react";
import type { ErrorPart } from "@/lib/parts";

export function ErrorBlock({ part }: { part: ErrorPart }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>{part.message}</span>
    </div>
  );
}
