/** Small fetch wrapper for the app's JSON API. */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  if (!res.ok) {
    let data: Record<string, unknown> = {};
    try {
      data = await res.json();
    } catch {
      // non-JSON error
    }
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) {
      // Session expired: a hard navigation clears all client state (used outside React, so no router).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`${window.location.origin}/login`);
    }
    throw new ApiError(
      typeof data.error === "string" ? data.error : `Request failed (${res.status})`,
      res.status,
      typeof data.code === "string" ? data.code : undefined,
      data,
    );
  }
  return (await res.json()) as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const resetsAt = typeof err.data?.resetsAt === "string" ? new Date(err.data.resetsAt) : null;
    if (resetsAt) {
      const when = resetsAt.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
      return `${err.message} It resets ${when} at 00:00 UTC.`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
