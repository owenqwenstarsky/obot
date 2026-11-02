import { Code2, FileText, Globe } from "lucide-react";
import type { ArtifactKindName } from "./artifact-frame";

export const KIND_LABEL: Record<ArtifactKindName, string> = { markdown: "Document", html: "HTML", react: "React" };

export function KindIcon({ kind, className }: { kind: ArtifactKindName; className?: string }) {
  const Icon = kind === "react" ? Code2 : kind === "html" ? Globe : FileText;
  return <Icon className={className} />;
}
