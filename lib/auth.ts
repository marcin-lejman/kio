import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

/**
 * Get the authenticated user from request cookies.
 * For use in API Route Handlers.
 */
export async function getSessionUser(request: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {
          // Route Handlers don't need to set cookies here —
          // the middleware handles token refresh.
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Verify the caller is an authenticated admin.
 * Returns the user if admin, or a 403 response.
 */
export async function requireAdmin(
  request: NextRequest
): Promise<
  | { user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>; error?: never }
  | { user?: never; error: NextResponse }
> {
  const user = await getSessionUser(request);
  if (!user) {
    return { error: unauthorized() };
  }
  if (user.app_metadata?.role !== "admin") {
    return { error: forbidden() };
  }
  return { user };
}

export function unauthorized() {
  return NextResponse.json(
    { error: "Authentication required" },
    { status: 401 }
  );
}

export function forbidden() {
  return NextResponse.json(
    { error: "Insufficient permissions" },
    { status: 403 }
  );
}
