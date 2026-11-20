import { NextResponse } from "next/server";

/**
 * The legacy NextAuth handlers are intentionally disabled.
 *
 * Authentication now uses signed, httpOnly cookie sessions issued by
 * /api/login and cleared by /api/logout. This module is kept as a stub so old
 * bookmarks receive an explicit, descriptive response instead of a broken
 * NextAuth configuration error.
 */
const MESSAGE =
  "NextAuth is no longer used by this application. " +
  "Sign in through /api/login, which sets the signed cc_session httpOnly cookie; " +
  "sign out through /api/logout.";

function gone() {
  return NextResponse.json(
    { error: "Gone", message: MESSAGE },
    { status: 410, headers: { "Cache-Control": "no-store" } }
  );
}

export const GET = gone;
export const POST = gone;
