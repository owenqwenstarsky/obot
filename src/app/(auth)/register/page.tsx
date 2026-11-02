import { connection } from "next/server";
import Link from "next/link";
import { isFirstRun } from "@/server/auth/register";
import { RegisterForm } from "@/components/auth/register-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  await connection();
  const firstRun = await isFirstRun();
  if (!firstRun) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invite only</CardTitle>
          <CardDescription>
            New accounts need an invite link from an admin of this instance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className="text-sm text-primary underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }
  return (
    <RegisterForm
      title="Set up Obot"
      description="You're the first person here, so this account will be the admin."
      submitLabel="Create admin account"
    />
  );
}
