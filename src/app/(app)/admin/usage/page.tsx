import { db } from "@/server/db";
import { UsageDashboard } from "@/components/usage/usage-dashboard";

export const metadata = { title: "Usage · Admin" };

export default async function Page() {
  const users = await db.user.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: "asc" } });
  return <UsageDashboard scope="admin" users={users} />;
}
