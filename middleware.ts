import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware for route protection.
 *
 * Currently configured as a pass-through — all routes are accessible.
 * To enable auth protection:
 * 1. Set up Supabase Auth (invite-only)
 * 2. Uncomment the auth check below
 * 3. Create /login page
 *
 * The search API routes don't require auth by default to allow
 * easy testing via curl during development. Enable auth for production.
 */
export function middleware(request: NextRequest) {
  // === Auth protection (uncomment for production) ===
  //
  // const { pathname } = request.nextUrl;
  //
  // // Public routes
  // if (pathname === "/login" || pathname.startsWith("/api/auth")) {
  //   return NextResponse.next();
  // }
  //
  // // Check for Supabase session cookie
  // const hasSession = request.cookies.getAll().some(
  //   (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token")
  // );
  //
  // if (!hasSession) {
  //   return NextResponse.redirect(new URL("/login", request.url));
  // }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files and _next
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
