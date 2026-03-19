import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFolderAccess, hasAccess } from "@/lib/folders";

// PATCH — edit own note
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id, noteId } = await params;
  const folderId = parseInt(id, 10);
  const noteIdNum = parseInt(noteId, 10);
  if (isNaN(folderId) || isNaN(noteIdNum)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { folder, access } = await getFolderAccess(supabase, folderId, user.id);

  if (!folder || !hasAccess(access, "read_write")) {
    return NextResponse.json({ error: "Brak uprawnień." }, { status: 403 });
  }

  // Verify note exists and belongs to this folder + is authored by user
  const { data: note } = await supabase
    .from("folder_notes")
    .select("id, author_id")
    .eq("id", noteIdNum)
    .eq("folder_id", folderId)
    .single();

  if (!note) {
    return NextResponse.json({ error: "Notatka nie istnieje." }, { status: 404 });
  }

  if (note.author_id !== user.id) {
    return NextResponse.json({ error: "Można edytować tylko własne notatki." }, { status: 403 });
  }

  const body = await request.json();
  const { content } = body;

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "Treść notatki jest wymagana." }, { status: 400 });
  }
  if (content.length > 10000) {
    return NextResponse.json({ error: "Notatka nie może przekraczać 10000 znaków." }, { status: 400 });
  }

  const { error } = await supabase
    .from("folder_notes")
    .update({ content: content.trim() })
    .eq("id", noteIdNum);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE — delete own note (or any note if folder owner)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id, noteId } = await params;
  const folderId = parseInt(id, 10);
  const noteIdNum = parseInt(noteId, 10);
  if (isNaN(folderId) || isNaN(noteIdNum)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { folder, access } = await getFolderAccess(supabase, folderId, user.id);

  if (!folder || !hasAccess(access, "read_write")) {
    return NextResponse.json({ error: "Brak uprawnień." }, { status: 403 });
  }

  // Verify note exists
  const { data: note } = await supabase
    .from("folder_notes")
    .select("id, author_id")
    .eq("id", noteIdNum)
    .eq("folder_id", folderId)
    .single();

  if (!note) {
    return NextResponse.json({ error: "Notatka nie istnieje." }, { status: 404 });
  }

  // Only author or folder owner can delete
  if (note.author_id !== user.id && access !== "owner") {
    return NextResponse.json({ error: "Brak uprawnień do usunięcia tej notatki." }, { status: 403 });
  }

  const { error } = await supabase
    .from("folder_notes")
    .delete()
    .eq("id", noteIdNum);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
