import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifyToken } from "@/lib/session-token";

const SIGNIN_PATH = "/auth/signin";

/**
 * First visit guard: every page except the sign-in flow requires a valid,
 * unexpired session cookie. This is an optimistic check (no DB lookup) that
 * runs before rendering; `getSessionUser()` in the APIs remains authoritative
 * for roles and deactivated accounts.
 */
export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Keep the sign-in flow reachable so users can log in or switch accounts.
  if (pathname.startsWith("/auth/")) return NextResponse.next();

  // Route handlers return their own JSON 401s; an HTML redirect would break
  // client-side session checks such as /api/auth/me.
  if (pathname.startsWith("/api/")) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (verifyToken(token)) return NextResponse.next();

  return NextResponse.redirect(new URL(SIGNIN_PATH, request.url));
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files so the sign-in page still loads
    // its CSS/JS/images even when the visitor has no session cookie.
    "/((?!_next/|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$).*)",
  ],
};
