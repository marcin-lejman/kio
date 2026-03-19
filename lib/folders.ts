import { SupabaseClient } from "@supabase/supabase-js";

export type FolderAccess = "owner" | "read_write" | "read" | null;

export interface FolderRow {
  id: number;
  owner_id: string;
  name: string;
  description: string | null;
  is_archived: boolean;
  item_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Check a user's access level to a folder.
 * Returns the folder row and access level, or null if not found / no access.
 */
export async function getFolderAccess(
  supabase: SupabaseClient,
  folderId: number,
  userId: string
): Promise<{ folder: FolderRow | null; access: FolderAccess }> {
  const { data: folder } = await supabase
    .from("folders")
    .select("*")
    .eq("id", folderId)
    .single();

  if (!folder) {
    return { folder: null, access: null };
  }

  if (folder.owner_id === userId) {
    return { folder, access: "owner" };
  }

  // Check shares
  const { data: share } = await supabase
    .from("folder_shares")
    .select("permission")
    .eq("folder_id", folderId)
    .eq("user_id", userId)
    .single();

  if (!share) {
    return { folder: null, access: null };
  }

  return {
    folder,
    access: share.permission === "read_write" ? "read_write" : "read",
  };
}

/**
 * Check if access level meets the minimum requirement.
 */
export function hasAccess(
  actual: FolderAccess,
  required: "read" | "read_write" | "owner"
): boolean {
  if (!actual) return false;
  if (required === "read") return true;
  if (required === "read_write") return actual === "owner" || actual === "read_write";
  if (required === "owner") return actual === "owner";
  return false;
}
