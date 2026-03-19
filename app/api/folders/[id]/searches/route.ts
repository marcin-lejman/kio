import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFolderAccess, hasAccess } from "@/lib/folders";
import { rateLimit } from "@/lib/rate-limit";

// GET — list saved searches in folder
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, { maxRequests: 60, windowMs: 60_000, prefix: "folder-searches" });
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

  const { data: searches, error } = await supabase
    .from("folder_saved_queries")
    .select("*")
    .eq("folder_id", folderId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get adder emails
  const adderIds = [...new Set((searches || []).map((s) => s.added_by).filter(Boolean))];
  let emailMap = new Map<string, string>();
  if (adderIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", adderIds);
    emailMap = new Map((profiles || []).map((p) => [p.id, p.email]));
  }

  const enriched = (searches || []).map((s) => ({
    ...s,
    added_by_email: emailMap.get(s.added_by) || null,
  }));

  return NextResponse.json({ searches: enriched });
}

// POST — save a search reference to folder
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, { maxRequests: 20, windowMs: 60_000, prefix: "folder-searches-add" });
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
  const { search_id, label } = body;

  if (!search_id || typeof search_id !== "number") {
    return NextResponse.json({ error: "ID wyszukiwania jest wymagane." }, { status: 400 });
  }

  // Fetch the search details from search_history
  const { data: search, error: searchError } = await supabase
    .from("search_history")
    .select("id, query, filters")
    .eq("id", search_id)
    .single();

  if (searchError || !search) {
    return NextResponse.json({ error: "Nie znaleziono wyszukiwania." }, { status: 404 });
  }

  // Check for duplicate
  const { data: existing } = await supabase
    .from("folder_saved_queries")
    .select("id")
    .eq("folder_id", folderId)
    .eq("search_id", search_id)
    .single();

  if (existing) {
    return NextResponse.json({ error: "To wyszukiwanie jest już zapisane w tej teczce." }, { status: 409 });
  }

  const { data: saved, error: insertError } = await supabase
    .from("folder_saved_queries")
    .insert({
      folder_id: folderId,
      search_id: search.id,
      label: label || null,
      query_text: search.query,
      filters: search.filters || null,
      added_by: user.id,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json(saved, { status: 201 });
}
