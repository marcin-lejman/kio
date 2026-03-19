import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFolderAccess, hasAccess } from "@/lib/folders";

// GET — list tags on an item
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id, itemId } = await params;
  const folderId = parseInt(id, 10);
  const itemIdNum = parseInt(itemId, 10);
  if (isNaN(folderId) || isNaN(itemIdNum)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { folder, access } = await getFolderAccess(supabase, folderId, user.id);

  if (!folder || !hasAccess(access, "read")) {
    return NextResponse.json({ error: "Nie znaleziono teczki." }, { status: 404 });
  }

  const { data: itemTags, error } = await supabase
    .from("folder_item_tags")
    .select("tag_id, folder_tags(id, name, color)")
    .eq("item_id", itemIdNum);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const tags = (itemTags || []).map((it) => (it as Record<string, unknown>).folder_tags).filter(Boolean);
  return NextResponse.json({ tags });
}

// POST — assign tag to item
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id, itemId } = await params;
  const folderId = parseInt(id, 10);
  const itemIdNum = parseInt(itemId, 10);
  if (isNaN(folderId) || isNaN(itemIdNum)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { folder, access } = await getFolderAccess(supabase, folderId, user.id);

  if (!folder || !hasAccess(access, "read_write")) {
    return NextResponse.json({ error: "Brak uprawnień." }, { status: 403 });
  }

  const body = await request.json();
  const { tag_id } = body;

  if (!tag_id) {
    return NextResponse.json({ error: "ID tagu jest wymagane." }, { status: 400 });
  }

  // Verify tag belongs to this folder
  const { data: tag } = await supabase
    .from("folder_tags")
    .select("id")
    .eq("id", tag_id)
    .eq("folder_id", folderId)
    .single();

  if (!tag) {
    return NextResponse.json({ error: "Tag nie należy do tej teczki." }, { status: 400 });
  }

  // Verify item belongs to this folder
  const { data: item } = await supabase
    .from("folder_items")
    .select("id")
    .eq("id", itemIdNum)
    .eq("folder_id", folderId)
    .single();

  if (!item) {
    return NextResponse.json({ error: "Element nie istnieje w tej teczce." }, { status: 404 });
  }

  const { error: insertError } = await supabase
    .from("folder_item_tags")
    .insert({ item_id: itemIdNum, tag_id });

  if (insertError) {
    // Already assigned — idempotent
    if (insertError.code === "23505") {
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}

// DELETE — remove tag from item (via query param ?tag_id=N)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id, itemId } = await params;
  const folderId = parseInt(id, 10);
  const itemIdNum = parseInt(itemId, 10);
  const tagId = parseInt(request.nextUrl.searchParams.get("tag_id") || "", 10);
  if (isNaN(folderId) || isNaN(itemIdNum) || isNaN(tagId)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { folder, access } = await getFolderAccess(supabase, folderId, user.id);

  if (!folder || !hasAccess(access, "read_write")) {
    return NextResponse.json({ error: "Brak uprawnień." }, { status: 403 });
  }

  const { error } = await supabase
    .from("folder_item_tags")
    .delete()
    .eq("item_id", itemIdNum)
    .eq("tag_id", tagId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
