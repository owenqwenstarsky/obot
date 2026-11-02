export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, "You need to sign in.", "UNAUTHORIZED");
export const forbidden = () => new HttpError(403, "You don't have access to this.", "FORBIDDEN");
export const notFound = (what = "Resource") => new HttpError(404, `${what} not found.`, "NOT_FOUND");
export const badRequest = (message: string) => new HttpError(400, message, "BAD_REQUEST");
