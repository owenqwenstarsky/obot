"use client";

import { ArtifactView } from "./artifact-view";

/** Full-page artifact viewer, independent of any chat. */
export function ArtifactViewer({ artifactId }: { artifactId: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ArtifactView artifactId={artifactId} variant="page" />
    </div>
  );
}
