import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFolderAccess, hasAccess } from "@/lib/folders";
import { rateLimit } from "@/lib/rate-limit";

// GET — list folder-level discussion comments
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, { maxRequests: 60, windowMs: 60_000, prefix: "folder-notes" });
  if (limited) return limited;

  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id } = await params;
  const folderId = parseInt(id, 10);
  if (isNaN(folderId)) {
    return NextResponse.json({ error: "Invalid folder ID" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { folder, access } = await getFolderAccess(supabase, folderId, user.id);

  if (!folder || !hasAccess(access, "read")) {
    return NextResponse.json({ error: "Nie znaleziono teczki." }, { status: 404 });
  }

  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50", 10);
  const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0", 10);

  const { data: comments, error, count } = await supabase
    .from("folder_notes")
    .select("*", { count: "exact" })
    .eq("folder_id", folderId)
    .is("item_id", null)
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get author emails
  const authorIds = [...new Set((comments || []).map((c) => c.author_id))];
  let emailMap = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", authorIds);
    emailMap = new Map((profiles || []).map((p) => [p.id, p.email]));
  }

  const enrichedComments = (comments || []).map((c) => ({
    ...c,
    author_email: emailMap.get(c.author_id) || "?",
  }));

  return NextResponse.json({ comments: enrichedComments, total: count || 0 });
}

// POST — add folder-level comment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, { maxRequests: 20, windowMs: 60_000, prefix: "folder-notes-create" });
  if (limited) return limited;

  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id } = await params;
  const folderId = parseInt(id, 10);
  if (isNaN(folderId)) {
    return NextResponse.json({ error: "Invalid folder ID" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { folder, access } = await getFolderAccess(supabase, folderId, user.id);

  if (!folder || !hasAccess(access, "read_write")) {
    return NextResponse.json({ error: "Brak uprawnień do dodawania komentarzy." }, { status: 403 });
  }

  const body = await request.json();
  const { content } = body;

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "Treść komentarza jest wymagana." }, { status: 400 });
  }
  if (content.length > 10000) {
    return NextResponse.json({ error: "Komentarz nie może przekraczać 10000 znaków." }, { status: 400 });
  }

  const { data: comment, error } = await supabase
    .from("folder_notes")
    .insert({
      folder_id: folderId,
      item_id: null,
      author_id: user.id,
      content: content.trim(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .single();

  return NextResponse.json(
    { ...comment, author_email: profile?.email || user.email },
    { status: 201 }
  );
}
