import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFolderAccess, hasAccess } from "@/lib/folders";
import { rateLimit } from "@/lib/rate-limit";

// GET — list tags for folder
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, { maxRequests: 60, windowMs: 60_000, prefix: "folder-tags" });
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

  const { data: tags, error } = await supabase
    .from("folder_tags")
    .select("*")
    .eq("folder_id", folderId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tags: tags || [] });
}

// POST — create tag
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, { maxRequests: 20, windowMs: 60_000, prefix: "folder-tags" });
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
    return NextResponse.json({ error: "Brak uprawnień." }, { status: 403 });
  }

  const body = await request.json();
  const { name, color } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Nazwa tagu jest wymagana." }, { status: 400 });
  }
  if (name.length > 50) {
    return NextResponse.json({ error: "Nazwa tagu nie może przekraczać 50 znaków." }, { status: 400 });
  }

  // Check tag limit per folder
  const { data: existing } = await supabase
    .from("folder_tags")
    .select("id")
    .eq("folder_id", folderId);

  if ((existing || []).length >= 20) {
    return NextResponse.json({ error: "Maksymalnie 20 tagów na teczkę." }, { status: 400 });
  }

  const { data: tag, error: insertError } = await supabase
    .from("folder_tags")
    .insert({
      folder_id: folderId,
      name: name.trim(),
      color: color || "#6b7280",
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "Tag o tej nazwie już istnieje." }, { status: 409 });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json(tag, { status: 201 });
}
