import { PageShell } from "@/components/page/page-shell";
import { UsageDashboard } from "@/components/usage/usage-dashboard";

export const metadata = { title: "Usage" };

export default function UsagePage() {
  return (
    <PageShell title="Usage" description="Your spend and token usage. Records are kept permanently. Pick any range.">
      <UsageDashboard scope="me" />
    </PageShell>
  );
}
