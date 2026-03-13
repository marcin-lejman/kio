import { createServerClient } from "./supabase";
import { NextRequest, NextResponse } from "next/server";

/**
 * Validate that the request has a valid Supabase session.
 * Reads the Authorization header (Bearer token) or sb-* cookies.
 *
 * For API routes: returns the user or null.
 * For middleware: redirects to /login if no session.
 */
export async function getUser(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) return null;

  const supabase = createServerClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

/**
 * Simple auth check for server-side operations.
 * Returns 401 response if not authenticated.
 */
export function unauthorized() {
  return NextResponse.json(
    { error: "Authentication required" },
    { status: 401 }
  );
}
