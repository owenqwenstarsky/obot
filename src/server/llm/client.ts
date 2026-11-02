import "server-only";
import OpenAI from "openai";
import { env } from "@/config/env";

let client: OpenAI | null = null;

/** OpenAI SDK pointed at CLIProxyAPI. Only `/v1/responses` and `/v1/models` are used. */
export function llm(): OpenAI {
  if (!client) {
    const { CLIPROXY_BASE_URL, CLIPROXY_API_KEY } = env();
    client = new OpenAI({
      baseURL: `${CLIPROXY_BASE_URL}/v1`,
      apiKey: CLIPROXY_API_KEY || "not-set",
      maxRetries: 1,
      timeout: 30 * 60 * 1000,
    });
  }
  return client;
}

export type UpstreamModel = { id: string; owned_by?: string };

export async function fetchUpstreamModels(signal?: AbortSignal): Promise<UpstreamModel[]> {
  const { CLIPROXY_BASE_URL, CLIPROXY_API_KEY } = env();
  const res = await fetch(`${CLIPROXY_BASE_URL}/v1/models`, {
    headers: CLIPROXY_API_KEY ? { Authorization: `Bearer ${CLIPROXY_API_KEY}` } : {},
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`CLIProxyAPI /v1/models returned ${res.status}`);
  const body = (await res.json()) as { data?: unknown };
  const data = Array.isArray(body.data) ? body.data : [];
  return data
    .map((m) => m as Record<string, unknown>)
    .filter((m) => typeof m.id === "string")
    .map((m) => ({ id: m.id as string, owned_by: typeof m.owned_by === "string" ? m.owned_by : undefined }));
}
