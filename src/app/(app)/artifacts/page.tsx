import { PageShell } from "@/components/page/page-shell";
import { ArtifactsBrowser } from "@/components/artifacts/artifacts-browser";

export const metadata = { title: "Artifacts" };

export default function ArtifactsPage() {
  return (
    <PageShell title="Artifacts" description="Documents, pages and apps the agent saved for you.">
      <ArtifactsBrowser />
    </PageShell>
  );
}
