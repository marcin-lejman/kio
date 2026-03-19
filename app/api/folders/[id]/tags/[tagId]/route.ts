import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFolderAccess, hasAccess } from "@/lib/folders";

// PATCH — update tag name/color
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tagId: string }> }
) {
  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id, tagId } = await params;
  const folderId = parseInt(id, 10);
  const tagIdNum = parseInt(tagId, 10);
  if (isNaN(folderId) || isNaN(tagIdNum)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { folder, access } = await getFolderAccess(supabase, folderId, user.id);

  if (!folder || !hasAccess(access, "read_write")) {
    return NextResponse.json({ error: "Brak uprawnień." }, { status: 403 });
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json({ error: "Nazwa tagu jest wymagana." }, { status: 400 });
    }
    updates.name = body.name.trim();
  }
  if (body.color !== undefined) {
    updates.color = body.color;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Brak zmian." }, { status: 400 });
  }

  const { error } = await supabase
    .from("folder_tags")
    .update(updates)
    .eq("id", tagIdNum)
    .eq("folder_id", folderId);

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Tag o tej nazwie już istnieje." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE — delete tag
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tagId: string }> }
) {
  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id, tagId } = await params;
  const folderId = parseInt(id, 10);
  const tagIdNum = parseInt(tagId, 10);
  if (isNaN(folderId) || isNaN(tagIdNum)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { folder, access } = await getFolderAccess(supabase, folderId, user.id);

  if (!folder || !hasAccess(access, "read_write")) {
    return NextResponse.json({ error: "Brak uprawnień." }, { status: 403 });
  }

  const { error } = await supabase
    .from("folder_tags")
    .delete()
    .eq("id", tagIdNum)
    .eq("folder_id", folderId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
