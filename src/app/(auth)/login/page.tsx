import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { isFirstRun } from "@/server/auth/register";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  await connection();
  if (await isFirstRun()) redirect("/register");
  if (await getCurrentUser()) redirect("/");
  return <LoginForm />;
}
