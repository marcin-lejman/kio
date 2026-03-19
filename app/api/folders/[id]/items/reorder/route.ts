import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFolderAccess, hasAccess } from "@/lib/folders";

// PATCH — reorder items in folder
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { item_ids } = body;

  if (!Array.isArray(item_ids) || item_ids.length === 0) {
    return NextResponse.json({ error: "Lista elementów jest wymagana." }, { status: 400 });
  }

  // Update positions in a batch
  const updates = item_ids.map((itemId: number, index: number) =>
    supabase
      .from("folder_items")
      .update({ position: index })
      .eq("id", itemId)
      .eq("folder_id", folderId)
  );

  await Promise.all(updates);

  return NextResponse.json({ success: true });
}
