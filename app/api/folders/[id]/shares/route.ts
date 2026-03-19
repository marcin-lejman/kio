import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFolderAccess, hasAccess } from "@/lib/folders";
import { rateLimit } from "@/lib/rate-limit";

// GET — list folder shares (members)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, { maxRequests: 30, windowMs: 60_000, prefix: "folder-shares" });
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

  // Get owner info
  const { data: ownerProfile } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("id", folder.owner_id)
    .single();

  // Get shares with user emails
  const { data: shares, error } = await supabase
    .from("folder_shares")
    .select("*")
    .eq("folder_id", folderId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = (shares || []).map((s) => s.user_id);
  let emailMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", userIds);
    emailMap = new Map((profiles || []).map((p) => [p.id, p.email]));
  }

  const enrichedShares = (shares || []).map((s) => ({
    id: s.id,
    user_id: s.user_id,
    email: emailMap.get(s.user_id) || "?",
    permission: s.permission,
    created_at: s.created_at,
  }));

  return NextResponse.json({
    owner: { id: folder.owner_id, email: ownerProfile?.email || "?" },
    shares: enrichedShares,
  });
}

// POST — share folder with a user
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, { maxRequests: 10, windowMs: 60_000, prefix: "folder-shares" });
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

  if (!folder || !hasAccess(access, "owner")) {
    return NextResponse.json({ error: "Tylko właściciel może udostępniać teczkę." }, { status: 403 });
  }

  const body = await request.json();
  const { user_id, permission } = body;

  if (!user_id || typeof user_id !== "string") {
    return NextResponse.json({ error: "ID użytkownika jest wymagane." }, { status: 400 });
  }

  if (!["read", "read_write"].includes(permission)) {
    return NextResponse.json({ error: "Nieprawidłowy poziom uprawnień." }, { status: 400 });
  }

  // Cannot share with self
  if (user_id === user.id) {
    return NextResponse.json({ error: "Nie można udostępnić teczki samemu sobie." }, { status: 400 });
  }

  // Verify user exists
  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("id", user_id)
    .single();

  if (!targetProfile) {
    return NextResponse.json({ error: "Użytkownik nie istnieje." }, { status: 404 });
  }

  const { data: share, error: insertError } = await supabase
    .from("folder_shares")
    .insert({
      folder_id: folderId,
      user_id,
      permission,
      granted_by: user.id,
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "Teczka jest już udostępniona temu użytkownikowi." }, { status: 409 });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json(
    { id: share.id, user_id, email: targetProfile.email, permission, created_at: share.created_at },
    { status: 201 }
  );
}
