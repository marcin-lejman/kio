import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFolderAccess, hasAccess } from "@/lib/folders";
import { rateLimit } from "@/lib/rate-limit";

// GET — list notes for a specific item
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const limited = rateLimit(request, { maxRequests: 60, windowMs: 60_000, prefix: "folder-notes" });
  if (limited) return limited;

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

  const { data: notes, error } = await supabase
    .from("folder_notes")
    .select("*")
    .eq("folder_id", folderId)
    .eq("item_id", itemIdNum)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get author emails
  const authorIds = [...new Set((notes || []).map((n) => n.author_id))];
  let emailMap = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", authorIds);
    emailMap = new Map((profiles || []).map((p) => [p.id, p.email]));
  }

  const enrichedNotes = (notes || []).map((n) => ({
    ...n,
    author_email: emailMap.get(n.author_id) || "?",
  }));

  return NextResponse.json({ notes: enrichedNotes });
}

// POST — add note to item
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const limited = rateLimit(request, { maxRequests: 20, windowMs: 60_000, prefix: "folder-notes-create" });
  if (limited) return limited;

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
    return NextResponse.json({ error: "Brak uprawnień do dodawania notatek." }, { status: 403 });
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

  const body = await request.json();
  const { content } = body;

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "Treść notatki jest wymagana." }, { status: 400 });
  }
  if (content.length > 10000) {
    return NextResponse.json({ error: "Notatka nie może przekraczać 10000 znaków." }, { status: 400 });
  }

  const { data: note, error } = await supabase
    .from("folder_notes")
    .insert({
      folder_id: folderId,
      item_id: itemIdNum,
      author_id: user.id,
      content: content.trim(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get author email
  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .single();

  return NextResponse.json(
    { ...note, author_email: profile?.email || user.email },
    { status: 201 }
  );
}
