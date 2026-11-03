import { NewThreadView } from "@/components/chat/new-thread-view";

export default async function NewThreadPage({ searchParams }: PageProps<"/">) {
  const { project } = await searchParams;
  return <NewThreadView projectId={typeof project === "string" && project ? project : null} />;
}
