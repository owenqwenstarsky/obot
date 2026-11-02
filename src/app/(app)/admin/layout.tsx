import { requireAdminPage } from "@/server/auth/session";
import { AdminNav } from "@/components/admin/admin-nav";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdminPage();
  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 pt-14 pb-12 sm:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage people, models, pricing, and instance defaults.</p>
        </div>
        <AdminNav />
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
