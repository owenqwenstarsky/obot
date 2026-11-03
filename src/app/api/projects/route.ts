import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { createProject, listProjects } from "@/server/projects";
import { handler, json, parseBody } from "@/server/http";
import { projectFields } from "@/server/projects-schema";

export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  return json({ projects: await listProjects(user) });
});

const createSchema = z.object({ name: z.string().min(1).max(100), ...projectFields });

export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = await parseBody(req, createSchema);
  return json({ project: await createProject(user, body) });
});
