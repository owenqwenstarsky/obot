import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, badRequest } from "@/server/auth/errors";

/** JSON helper that serializes BigInt as Number. */
export function json(data: unknown, init?: ResponseInit) {
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
  return new NextResponse(body, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return json({ error: err.message, code: err.code, ...(err.extra ?? {}) }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return json({ error: err.issues[0]?.message ?? "Invalid request", code: "BAD_REQUEST" }, { status: 400 });
  }
  console.error("[api] unhandled error", err);
  return json({ error: "Something went wrong.", code: "INTERNAL" }, { status: 500 });
}

/** Wrap a route handler so thrown HttpErrors become JSON responses. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Expected a JSON body.");
  }
  return schema.parse(raw);
}
