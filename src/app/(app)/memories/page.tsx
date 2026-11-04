import { PageShell } from "@/components/page/page-shell";
import { MemoriesManager } from "@/components/memories/memories-manager";

export const metadata = { title: "Memories" };

export default function MemoriesPage() {
  return (
    <PageShell title="Memories" description="What the agent remembers about you across threads.">
      <MemoriesManager />
    </PageShell>
  );
}
