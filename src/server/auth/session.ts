import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { db } from "@/server/db";
import { forbidden, unauthorized } from "@/server/auth/errors";
import { canUseApp, isAdmin } from "@/server/auth/policy";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DISABLED";
};

async function loadUser(reqHeaders: Headers): Promise<CurrentUser | null> {
  const session = await auth().api.getSession({ headers: reqHeaders });
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, status: true },
  });
  if (!user || !canUseApp(user)) return null;
  return user;
}

/** Per-request cached current user for Server Components. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  return loadUser(await headers());
});

/** For pages: redirect to /login if not signed in. */
export async function requireUserPage(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdminPage(): Promise<CurrentUser> {
  const user = await requireUserPage();
  if (!isAdmin(user)) redirect("/");
  return user;
}

/** For route handlers: throw HttpError(401/403). */
export async function requireUser(req?: Request): Promise<CurrentUser> {
  const user = req ? await loadUser(req.headers) : await getCurrentUser();
  if (!user) throw unauthorized();
  return user;
}

export async function requireAdmin(req?: Request): Promise<CurrentUser> {
  const user = await requireUser(req);
  if (!isAdmin(user)) throw forbidden();
  return user;
}
