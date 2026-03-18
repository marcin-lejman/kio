import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// PATCH — update user role
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error: authError } = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const { role } = await request.json();

  if (!["regular", "admin"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Last-admin protection: cannot demote if only admin
  if (role !== "admin") {
    const { data: admins } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "admin");
    if ((admins || []).length <= 1 && (admins || []).some((a) => a.id === id)) {
      return NextResponse.json(
        { error: "Nie można zdegradować ostatniego administratora." },
        { status: 400 }
      );
    }
  }

  // Update app_metadata in auth.users
  const { error: updateAuthError } = await supabase.auth.admin.updateUserById(
    id,
    { app_metadata: { role } }
  );
  if (updateAuthError) {
    return NextResponse.json({ error: updateAuthError.message }, { status: 500 });
  }

  // Update profiles table
  const { error: updateProfileError } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", id);
  if (updateProfileError) {
    return NextResponse.json({ error: updateProfileError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE — delete user
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error: authError } = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;

  // Self-protection
  if (id === user.id) {
    return NextResponse.json(
      { error: "Nie można usunąć własnego konta." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Last-admin protection
  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", id)
    .single();

  if (targetProfile?.role === "admin") {
    const { data: admins } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "admin");
    if ((admins || []).length <= 1) {
      return NextResponse.json(
        { error: "Nie można usunąć ostatniego administratora." },
        { status: 400 }
      );
    }
  }

  // Delete from auth.users — cascade deletes profiles row
  const { error: deleteError } = await supabase.auth.admin.deleteUser(id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
