import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;

  const supabase = createAdminClient();

  // Fetch all users from auth + profiles
  const {
    data: { users },
    error: listError,
  } = await supabase.auth.admin.listUsers({ perPage: 1000 });

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  // Fetch profiles for role/suspended info
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, role, suspended, invited_by, created_at");

  const profileMap = new Map(
    (profiles || []).map((p) => [p.id, p])
  );

  const result = (users || [])
    .filter((u) => u.email_confirmed_at) // Only confirmed users
    .map((u) => {
      const profile = profileMap.get(u.id);
      return {
        id: u.id,
        email: u.email,
        role: profile?.role || u.app_metadata?.role || "regular",
        suspended: profile?.suspended || false,
        created_at: profile?.created_at || u.created_at,
        last_sign_in_at: u.last_sign_in_at,
      };
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return NextResponse.json({ users: result });
}
