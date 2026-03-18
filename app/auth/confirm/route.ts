import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

/**
 * Handles the token exchange when a user clicks an invitation or
 * password-reset link from Supabase email.
 *
 * Supabase appends `token_hash` and `type` as query parameters.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as
    | "invite"
    | "recovery"
    | "email"
    | "signup"
    | null;

  const redirectTo = request.nextUrl.clone();

  if (!tokenHash || !type) {
    redirectTo.pathname = "/login";
    redirectTo.searchParams.set("error", "invalid_link");
    return NextResponse.redirect(redirectTo);
  }

  // Build a Supabase client that can write cookies to the response
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

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error) {
    redirectTo.pathname = "/login";
    redirectTo.searchParams.set("error", "invalid_link");
    return NextResponse.redirect(redirectTo);
  }

  // Invitation → set password page; recovery → home
  if (type === "invite") {
    redirectTo.pathname = "/auth/set-password";
  } else {
    redirectTo.pathname = "/auth/set-password";
  }
  redirectTo.search = "";

  // Copy cookies from the SSR client response to the redirect
  const redirect = NextResponse.redirect(redirectTo);
  response.cookies.getAll().forEach((cookie) => {
    redirect.cookies.set(cookie.name, cookie.value);
  });

  return redirect;
}
