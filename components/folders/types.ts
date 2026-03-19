export interface Folder {
  id: number;
  owner_id: string;
  name: string;
  description: string | null;
  is_archived: boolean;
  item_count: number;
  search_count: number;
  created_at: string;
  updated_at: string;
  // Populated for display:
  owner_email?: string;
  role?: "owner" | "read_write" | "read";
}

export interface FolderItem {
  id: number;
  folder_id: number;
  verdict_id: number;
  position: number;
  added_from: string | null;
  added_by: string;
  created_at: string;
  // Joined from verdicts table
  sygnatura: string;
  verdict_date: string | null;
  document_type_normalized: string | null;
  decision_type_normalized: string | null;
  summary: string | null;
  // Aggregated
  tags: FolderTag[];
  note_count: number;
}

export interface FolderTag {
  id: number;
  folder_id: number;
  name: string;
  color: string;
}

export interface FolderSavedSearch {
  id: number;
  folder_id: number;
  search_id: number | null;
  label: string | null;
  query_text: string;
  filters: Record<string, unknown> | null;
  added_by: string;
  added_by_email: string | null;
  created_at: string;
}

export interface FolderAnalysis {
  id: number;
  folder_id: number;
  title: string;
  questions: string[];
  template: string | null;
  verdict_ids: number[];
  result: string | null;
  status: "pending" | "running" | "completed" | "error";
  model: string | null;
  tokens_used: number | null;
  cost_usd: number | null;
  error_message: string | null;
  created_by: string;
  created_at: string;
  completed_at: string | null;
}

export interface FolderNote {
  id: number;
  folder_id: number;
  item_id: number | null;
  author_id: string;
  author_email: string;
  content: string;
  created_at: string;
  updated_at: string;
}
