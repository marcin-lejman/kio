import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// POST — send password reset email
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const supabase = createAdminClient();

  // Get user email
  const {
    data: { user: targetUser },
    error: getUserError,
  } = await supabase.auth.admin.getUserById(id);

  if (getUserError || !targetUser) {
    return NextResponse.json(
      { error: "Nie znaleziono użytkownika." },
      { status: 404 }
    );
  }

  // Generate password reset link (sends email automatically)
  const { error: resetError } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email: targetUser.email!,
  });

  if (resetError) {
    return NextResponse.json({ error: resetError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
