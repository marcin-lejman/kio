import { createBrowserClient as createSupabaseBrowserClient } from "@supabase/ssr";

/**
 * Browser client for Client Components.
 * Uses anon key — respects RLS.
 */
export function createBrowserClient() {
  return createSupabaseBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
