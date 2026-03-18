import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

/**
 * Handles PKCE code exchange for invitation/recovery links
 * that use the `code` parameter instead of `token_hash`.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  const redirectTo = request.nextUrl.clone();

  if (!code) {
    redirectTo.pathname = "/login";
    redirectTo.searchParams.set("error", "invalid_link");
    return NextResponse.redirect(redirectTo);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    redirectTo.pathname = "/login";
    redirectTo.searchParams.set("error", "invalid_link");
    return NextResponse.redirect(redirectTo);
  }

  redirectTo.pathname = "/auth/set-password";
  redirectTo.search = "";

  const redirect = NextResponse.redirect(redirectTo);
  response.cookies.getAll().forEach((cookie) => {
    redirect.cookies.set(cookie.name, cookie.value);
  });

  return redirect;
}
