import { ChatView } from "@/components/chat/chat-view";

export default async function ThreadPage({ params, searchParams }: PageProps<"/t/[threadId]">) {
  const { threadId } = await params;
  const { m } = await searchParams;
  return <ChatView key={threadId} threadId={threadId} focusMessageId={typeof m === "string" ? m : null} />;
}
