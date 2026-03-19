import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// POST — set new password for user
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const { password } = await request.json();

  if (!password || typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Hasło musi mieć co najmniej 8 znaków." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  const { error: updateError } = await supabase.auth.admin.updateUserById(id, {
    password,
  });

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
