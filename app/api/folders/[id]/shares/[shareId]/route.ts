import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFolderAccess, hasAccess } from "@/lib/folders";

// PATCH — update share permission
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id, shareId } = await params;
  const folderId = parseInt(id, 10);
  const shareIdNum = parseInt(shareId, 10);
  if (isNaN(folderId) || isNaN(shareIdNum)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { folder, access } = await getFolderAccess(supabase, folderId, user.id);

  if (!folder || !hasAccess(access, "owner")) {
    return NextResponse.json({ error: "Tylko właściciel może zmieniać uprawnienia." }, { status: 403 });
  }

  const body = await request.json();
  const { permission } = body;

  if (!["read", "read_write"].includes(permission)) {
    return NextResponse.json({ error: "Nieprawidłowy poziom uprawnień." }, { status: 400 });
  }

  const { error } = await supabase
    .from("folder_shares")
    .update({ permission })
    .eq("id", shareIdNum)
    .eq("folder_id", folderId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE — revoke share
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id, shareId } = await params;
  const folderId = parseInt(id, 10);
  const shareIdNum = parseInt(shareId, 10);
  if (isNaN(folderId) || isNaN(shareIdNum)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { folder, access } = await getFolderAccess(supabase, folderId, user.id);

  // Owner can revoke anyone. Shared user can remove themselves.
  if (!folder) {
    return NextResponse.json({ error: "Nie znaleziono teczki." }, { status: 404 });
  }

  if (!hasAccess(access, "owner")) {
    // Check if user is removing their own share
    const { data: share } = await supabase
      .from("folder_shares")
      .select("user_id")
      .eq("id", shareIdNum)
      .eq("folder_id", folderId)
      .single();

    if (!share || share.user_id !== user.id) {
      return NextResponse.json({ error: "Brak uprawnień." }, { status: 403 });
    }
  }

  const { error } = await supabase
    .from("folder_shares")
    .delete()
    .eq("id", shareIdNum)
    .eq("folder_id", folderId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
