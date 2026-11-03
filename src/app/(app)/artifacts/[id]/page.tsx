import { ArtifactViewer } from "@/components/artifacts/artifact-viewer";

export const metadata = { title: "Artifact" };

export default async function ArtifactPage({ params }: PageProps<"/artifacts/[id]">) {
  const { id } = await params;
  return <ArtifactViewer key={id} artifactId={id} />;
}
