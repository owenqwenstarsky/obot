import "server-only";
import { lookup } from "node:dns/promises";
import { Agent, request } from "undici";
import { createPinnedLookup } from "@/server/web/ssrf";
import { FETCH_TIMEOUT_MS, type HttpRequester } from "@/server/web/fetch-url";

const g = globalThis as unknown as { __obotFetchAgent?: Agent };

/** Undici agent whose sockets only ever connect to validated public addresses. */
function agent(): Agent {
  g.__obotFetchAgent ??= new Agent({
    connect: {
      lookup: createPinnedLookup((host) => lookup(host, { all: true, verbatim: true })) as never,
      timeout: FETCH_TIMEOUT_MS,
    },
    headersTimeout: FETCH_TIMEOUT_MS,
    bodyTimeout: FETCH_TIMEOUT_MS,
    connections: 16,
  });
  return g.__obotFetchAgent;
}

export const undiciRequester: HttpRequester = async (url, opts) => {
  const res = await request(url, {
    method: "GET",
    headers: opts.headers,
    signal: opts.signal,
    dispatcher: agent(),
  });
  return {
    status: res.statusCode,
    headers: res.headers,
    body: res.body,
    cancel: () => res.body.destroy(),
  };
};
