import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// GET — list pending invitations (unconfirmed users)
export async function GET(request: NextRequest) {
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;

  const supabase = createAdminClient();

  const {
    data: { users },
    error: listError,
  } = await supabase.auth.admin.listUsers({ perPage: 1000 });

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  // Pending = invited but not yet confirmed
  const pending = (users || [])
    .filter((u) => !u.email_confirmed_at)
    .map((u) => ({
      id: u.id,
      email: u.email,
      role: u.app_metadata?.role || "regular",
      invited_at: u.created_at,
    }))
    .sort((a, b) => new Date(b.invited_at).getTime() - new Date(a.invited_at).getTime());

  return NextResponse.json({ invitations: pending });
}

// POST — invite a new user
export async function POST(request: NextRequest) {
  const { user, error: authError } = await requireAdmin(request);
  if (authError) return authError;

  const { email, role } = await request.json();

  if (!email || !["regular", "admin"].includes(role)) {
    return NextResponse.json(
      { error: "Email i rola są wymagane." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Send invitation
  const { data, error: inviteError } =
    await supabase.auth.admin.inviteUserByEmail(email, {
      data: { role },
    });

  if (inviteError) {
    const message =
      inviteError.message === "A user with this email address has already been registered"
        ? "Użytkownik z tym adresem email już istnieje."
        : inviteError.message;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Set app_metadata.role and invited_by
  if (data?.user) {
    await supabase.auth.admin.updateUserById(data.user.id, {
      app_metadata: { role },
    });

    // Update profiles row (created by trigger) with invited_by
    await supabase
      .from("profiles")
      .update({ role, invited_by: user.id })
      .eq("id", data.user.id);
  }

  return NextResponse.json({ success: true, user_id: data?.user?.id });
}
