import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// POST — resend an invitation (delete + re-invite)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const supabase = createAdminClient();

  // Get the original user's email and role
  const {
    data: { user: targetUser },
    error: getUserError,
  } = await supabase.auth.admin.getUserById(id);

  if (getUserError || !targetUser) {
    return NextResponse.json(
      { error: "Nie znaleziono zaproszenia." },
      { status: 404 }
    );
  }

  const email = targetUser.email!;
  const role = targetUser.app_metadata?.role || "regular";

  // Delete the old user record
  const { error: deleteError } = await supabase.auth.admin.deleteUser(id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  // Re-invite
  const { data, error: inviteError } =
    await supabase.auth.admin.inviteUserByEmail(email, {
      data: { role },
    });

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 500 });
  }

  // Set app_metadata.role on the new user
  if (data?.user) {
    await supabase.auth.admin.updateUserById(data.user.id, {
      app_metadata: { role },
    });
  }

  return NextResponse.json({ success: true, new_user_id: data?.user?.id });
}
