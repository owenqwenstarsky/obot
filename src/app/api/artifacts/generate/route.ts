import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { startArtifactGeneration } from "@/server/agent/turns";
import { getArtifactDetail } from "@/server/artifacts";
import { handler, json, parseBody } from "@/server/http";

const schema = z.object({
  prompt: z.string().trim().min(1, "Describe what you want to create.").max(20_000),
  modelId: z.string().min(1),
  effort: z.string().nullable().optional(),
  webSearch: z.boolean().default(false),
  kind: z.enum(["markdown", "html", "react"]).nullable().optional(),
});

/** Start generating an artifact in a new background thread. Does not wait for it. */
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = await parseBody(req, schema);
  const res = await startArtifactGeneration(user, body);
  const artifact = await getArtifactDetail(user.id, res.artifactId);
  return json({ ...res, artifact }, { status: 201 });
});
