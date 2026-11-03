import { AdminSettings } from "@/components/admin/admin-settings";
import { AdminSubagents } from "@/components/admin/admin-subagents";

export const metadata = { title: "Settings · Admin" };

export default function Page() {
  return (
    <div className="grid gap-4">
      <AdminSettings />
      <AdminSubagents />
    </div>
  );
}
