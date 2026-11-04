import { ProjectView } from "@/components/projects/project-view";

export const metadata = { title: "Project" };

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  return <ProjectView key={id} projectId={id} />;
}
