import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC_PATHS = ["/login", "/register", "/invite"];

/** Optimistic redirect for signed-out visitors. Real auth checks happen in every route/page. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!getSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // artifact-runtime is loaded by sandboxed (opaque-origin, cookieless) artifact iframes.
  matcher: ["/((?!api|_next/static|_next/image|artifact-runtime/|favicon.ico|.*\\.(?:png|svg|ico|jpg|webp)$).*)"],
};
