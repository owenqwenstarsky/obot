"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ArtifactView } from "./artifact-view";

/** Full-page artifact viewer, independent of any chat. */
export function ArtifactViewer({ artifactId }: { artifactId: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col pt-12 md:pt-0">
      <div className="flex items-center px-4 pt-3 md:pl-28">
        <Link href="/artifacts" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> All artifacts
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        <ArtifactView artifactId={artifactId} variant="page" />
      </div>
    </div>
  );
}
