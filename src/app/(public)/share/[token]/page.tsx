import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { lookupShare } from "@/server/shares";
import { SharedThread } from "@/components/share/shared-thread";

export async function generateMetadata({ params }: PageProps<"/share/[token]">): Promise<Metadata> {
  await connection();
  const { token } = await params;
  const share = await lookupShare(token);
  return {
    title: share ? share.snapshot.title : "Shared thread",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function SharePage({ params }: PageProps<"/share/[token]">) {
  await connection();
  const { token } = await params;
  const share = await lookupShare(token);
  if (!share) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-medium">This link isn&apos;t available</p>
        <p className="max-w-sm text-sm text-muted-foreground">It may have been revoked by its owner, or the thread was deleted.</p>
        <Link href="/" className="text-sm text-primary hover:underline">
          Go to Obot
        </Link>
      </div>
    );
  }
  return <SharedThread token={token} snapshot={share.snapshot} />;
}
