import { PageShell } from "@/components/page/page-shell";
import { SettingsForm } from "@/components/settings/settings-form";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <PageShell title="Settings" description="Personal preferences for new threads.">
      <SettingsForm />
    </PageShell>
  );
}
