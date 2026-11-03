import { PageShell } from "@/components/page/page-shell";
import { ProjectsBrowser } from "@/components/projects/projects-browser";

export const metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <PageShell title="Projects" description="Folders of threads with shared instructions, files, and defaults.">
      <ProjectsBrowser />
    </PageShell>
  );
}
