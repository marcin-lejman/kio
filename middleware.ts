import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_ROUTES = ["/login", "/auth/confirm", "/auth/callback"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Refresh the session token and get the user
  const { supabaseResponse, user } = await updateSession(request);

  // Public routes — allow through
  if (PUBLIC_ROUTES.some((r) => pathname.startsWith(r))) {
    // Redirect already-authenticated users away from /login
    if (pathname === "/login" && user) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return supabaseResponse;
  }

  // No session — redirect to login
  if (!user) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Suspended user — clear session and redirect
  if (user.banned_until && new Date(user.banned_until) > new Date()) {
    // Clear all sb-* cookies
    const response = NextResponse.redirect(
      new URL("/login?suspended=true", request.url)
    );
    request.cookies.getAll().forEach((cookie) => {
      if (cookie.name.startsWith("sb-")) {
        response.cookies.delete(cookie.name);
      }
    });
    return response;
  }

  // Admin-only routes — verify admin role
  if (pathname.startsWith("/admin")) {
    if (user.app_metadata?.role !== "admin") {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Match all paths except static files and _next
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
