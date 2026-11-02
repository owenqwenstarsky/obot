import { ChatView } from "@/components/chat/chat-view";

export default async function ThreadPage({ params }: PageProps<"/t/[threadId]">) {
  const { threadId } = await params;
  return <ChatView key={threadId} threadId={threadId} />;
}
