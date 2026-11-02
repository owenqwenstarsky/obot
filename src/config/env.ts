import "server-only";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  CLIPROXY_BASE_URL: z
    .string()
    .url()
    .default("http://localhost:8317")
    .transform((v) => v.replace(/\/+$/, "").replace(/\/v1$/, "")),
  CLIPROXY_API_KEY: z.string().default(""),
  BETTER_AUTH_SECRET: z.string().min(16, "BETTER_AUTH_SECRET must be at least 16 characters"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  UPLOAD_DIR: z.string().default("./data/uploads"),
  /** Optional extra origins (comma-separated) allowed to sign in, besides APP_URL. */
  TRUSTED_ORIGINS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Lazily parsed so `next build` doesn't need runtime secrets. */
export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
