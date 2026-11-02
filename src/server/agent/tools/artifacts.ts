import { z } from "zod";
import { defineTool } from "@/server/agent/tools/types";

const kind = z.enum(["markdown", "html", "react"]);

export const createArtifactTool = defineTool({
  name: "create_artifact",
  description:
    "Save a standalone document or app as an artifact the user can open, browse, and download outside the chat. " +
    "ONLY use this when the user explicitly asks for an artifact (or a saved/standalone document, page, or app); otherwise answer in chat. " +
    "Kinds: markdown (a document), html (a complete self-contained HTML page; Tailwind classes work), " +
    "react (one TSX/JSX file that default-exports a component; only `react` and `lucide-react` can be imported; style with Tailwind classes). " +
    "Returns the artifact id; use update_artifact with that id for later changes.",
  schema: z.object({
    title: z.string().min(1).max(120).describe("Short, descriptive title."),
    kind,
    content: z.string().min(1).describe("The full artifact source."),
  }),
  available: (s) => s.threadKind === "CHAT" && s.flags.artifactsEnabled,
  concurrency: "serial",
  execute: async (args, ctx) => {
    const a = args as { title: string; kind: z.infer<typeof kind>; content: string };
    if (!ctx.services.artifacts) return { output: "Error: artifacts are not available.", isError: true };
    const r = await ctx.services.artifacts.create(a);
    return {
      output: `Created artifact ${r.artifactId} ("${r.title}", ${r.kind}, version ${r.version}). The user can open it from the chat or the Artifacts page.`,
      display: { kind: "artifact", artifactId: r.artifactId, version: r.version, title: r.title, artifactKind: r.kind },
    };
  },
});

export const updateArtifactTool = defineTool({
  name: "update_artifact",
  description:
    "Replace an existing artifact's content with a new full version (the old version is kept in history). Use when the user asks to change an artifact. Always send the complete new content, not a diff.",
  schema: z.object({
    artifact_id: z.string().min(1).describe("Id returned by create_artifact."),
    content: z.string().min(1).describe("The complete new artifact source."),
    title: z.string().min(1).max(120).optional().describe("New title, if it should change."),
  }),
  available: (s) => s.threadKind === "CHAT" && s.flags.artifactsEnabled,
  concurrency: "serial",
  execute: async (args, ctx) => {
    const a = args as { artifact_id: string; content: string; title?: string };
    if (!ctx.services.artifacts) return { output: "Error: artifacts are not available.", isError: true };
    const r = await ctx.services.artifacts.update({ artifactId: a.artifact_id, content: a.content, title: a.title });
    return {
      output: `Updated artifact ${r.artifactId} to version ${r.version}.`,
      display: { kind: "artifact", artifactId: r.artifactId, version: r.version, title: r.title, artifactKind: r.kind },
    };
  },
});

export const artifactTools = [createArtifactTool, updateArtifactTool];
