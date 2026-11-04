import { PageShell } from "@/components/page/page-shell";
import { PromptLibrary } from "@/components/prompts/prompt-library";

export const metadata = { title: "Prompts" };

export default function PromptsPage() {
  return (
    <PageShell title="Prompts" description="Saved prompts you can insert by typing / in the composer.">
      <PromptLibrary />
    </PageShell>
  );
}
