import { z } from "zod";
import { auth } from "@/server/auth/auth";
import { registerUser } from "@/server/auth/register";
import { handler, json, parseBody } from "@/server/http";

const schema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(8, "Password must be at least 8 characters.").max(256),
  inviteToken: z.string().max(200).nullish(),
});

export const POST = handler(async (req: Request) => {
  const body = await parseBody(req, schema);
  const user = await registerUser(body);
  // Sign the new user in (nextCookies plugin sets the session cookie).
  await auth().api.signInEmail({ body: { email: user.email, password: body.password }, headers: req.headers });
  return json({ ok: true, role: user.role });
});
