import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// POST — toggle suspend/unsuspend
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error: authError } = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const { suspend } = await request.json();

  // Self-protection
  if (id === user.id) {
    return NextResponse.json(
      { error: "Nie można zawiesić własnego konta." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Suspend via Supabase ban mechanism
  const { error: banError } = await supabase.auth.admin.updateUserById(id, {
    ban_duration: suspend ? "876000h" : "none",
  });
  if (banError) {
    return NextResponse.json({ error: banError.message }, { status: 500 });
  }

  // Update profiles table
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ suspended: suspend })
    .eq("id", id);
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, suspended: suspend });
}
