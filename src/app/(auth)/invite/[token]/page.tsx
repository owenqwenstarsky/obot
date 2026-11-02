import { connection } from "next/server";
import Link from "next/link";
import { lookupInvite } from "@/server/auth/register";
import { RegisterForm } from "@/components/auth/register-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Accept invite" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  await connection();
  const { token } = await params;
  const invite = await lookupInvite(token);
  if (!invite.valid) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invite unavailable</CardTitle>
          <CardDescription>{invite.reason}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className="text-sm text-primary underline-offset-4 hover:underline">
            Go to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }
  return (
    <RegisterForm
      title="You're invited"
      description={invite.role === "ADMIN" ? "Create your account. You'll join as an admin." : "Create your account to get started."}
      submitLabel="Create account"
      inviteToken={token}
      lockedEmail={invite.email}
    />
  );
}
