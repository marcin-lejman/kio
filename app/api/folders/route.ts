import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";

// GET — list user's folders (own + shared)
export async function GET(request: NextRequest) {
  const limited = rateLimit(request, { maxRequests: 30, windowMs: 60_000, prefix: "folders" });
  if (limited) return limited;

  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const showArchived = request.nextUrl.searchParams.get("archived") === "true";
  const supabase = createAdminClient();

  // Owned folders
  let ownQuery = supabase
    .from("folders")
    .select("*")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });

  if (!showArchived) {
    ownQuery = ownQuery.eq("is_archived", false);
  }

  const { data: ownFolders, error: ownError } = await ownQuery;
  if (ownError) {
    return NextResponse.json({ error: ownError.message }, { status: 500 });
  }

  // Shared folders
  const { data: shares, error: sharesError } = await supabase
    .from("folder_shares")
    .select("folder_id, permission")
    .eq("user_id", user.id);

  if (sharesError) {
    return NextResponse.json({ error: sharesError.message }, { status: 500 });
  }

  let sharedFolders: typeof ownFolders = [];
  if (shares && shares.length > 0) {
    const sharedIds = shares.map((s) => s.folder_id);
    let sharedQuery = supabase
      .from("folders")
      .select("*")
      .in("id", sharedIds)
      .order("updated_at", { ascending: false });

    if (!showArchived) {
      sharedQuery = sharedQuery.eq("is_archived", false);
    }

    const { data, error } = await sharedQuery;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    sharedFolders = data || [];
  }

  // Build permission map
  const shareMap = new Map(
    (shares || []).map((s) => [s.folder_id, s.permission])
  );

  // Get owner emails for shared folders
  const ownerIds = [...new Set((sharedFolders || []).map((f) => f.owner_id))];
  let emailMap = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", ownerIds);
    emailMap = new Map((profiles || []).map((p) => [p.id, p.email]));
  }

  const allFolders = [
    ...(ownFolders || []).map((f) => ({ ...f, role: "owner" as const })),
    ...(sharedFolders || []).map((f) => ({
      ...f,
      role: (shareMap.get(f.id) === "read_write" ? "read_write" : "read") as "read_write" | "read",
      owner_email: emailMap.get(f.owner_id) || null,
    })),
  ];

  // Get saved search counts per folder
  const allFolderIds = allFolders.map((f) => f.id);
  let searchCountMap = new Map<number, number>();
  if (allFolderIds.length > 0) {
    const { data: searchCounts } = await supabase
      .from("folder_saved_queries")
      .select("folder_id")
      .in("folder_id", allFolderIds);
    for (const row of searchCounts || []) {
      searchCountMap.set(row.folder_id, (searchCountMap.get(row.folder_id) || 0) + 1);
    }
  }

  const folders = allFolders.map((f) => ({
    ...f,
    search_count: searchCountMap.get(f.id) || 0,
  }));

  return NextResponse.json({ folders });
}

// POST — create folder
export async function POST(request: NextRequest) {
  const limited = rateLimit(request, { maxRequests: 10, windowMs: 60_000, prefix: "folders-create" });
  if (limited) return limited;

  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const body = await request.json();
  const { name, description } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Nazwa teczki jest wymagana." }, { status: 400 });
  }
  if (name.length > 200) {
    return NextResponse.json({ error: "Nazwa teczki nie może przekraczać 200 znaków." }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: folder, error } = await supabase
    .from("folders")
    .insert({
      owner_id: user.id,
      name: name.trim(),
      description: description?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(folder, { status: 201 });
}
