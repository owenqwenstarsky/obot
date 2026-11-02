import { requireUserPage } from "@/server/auth/session";
import { AppShell } from "@/components/app/app-shell";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUserPage();
  return (
    <AppShell user={{ id: user.id, name: user.name, email: user.email, role: user.role }}>{children}</AppShell>
  );
}
