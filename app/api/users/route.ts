import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";

// GET — list platform users (id + email only, for sharing picker)
export async function GET(request: NextRequest) {
  const limited = rateLimit(request, { maxRequests: 20, windowMs: 60_000, prefix: "users-list" });
  if (limited) return limited;

  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const supabase = createAdminClient();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("suspended", false)
    .neq("id", user.id)
    .order("email", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: profiles || [] });
}
