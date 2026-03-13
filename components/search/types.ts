export interface SearchFilters {
  document_type?: string;
  decision_type?: string;
  date_from?: string;
  date_to?: string;
}

export interface MatchingPassage {
  chunk_text: string;
  section_label: string;
  score: number;
}

export interface VerdictResult {
  verdict_id: number;
  sygnatura: string;
  verdict_date: string;
  document_type: string;
  document_type_normalized: string;
  decision_type: string;
  decision_type_normalized: string;
  relevance_score: number;
  matching_passages: MatchingPassage[];
}

export interface CostEntry {
  layer: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
}

export interface SearchMetadataType {
  time_ms: number;
  tokens_used: number;
  cost_usd: number;
  costs: CostEntry[];
}

export interface DebugData {
  query_understanding: {
    keywords: string[];
    semantic_query: string;
    filters: Record<string, string>;
  } | null;
  fts_query?: string;
  fts_results?: { sygnatura: string; section_label: string; score: number; chunk_text_preview: string }[];
  vector_results?: { sygnatura: string; section_label: string; score: number; chunk_text_preview: string }[];
  fused_results?: { sygnatura: string; section_label: string; score: number; source: string }[];
}

export const ANSWER_MODELS = [
  { id: "google/gemini-3.1-flash-lite-preview", label: "Gemini Flash Lite" },
  { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
];
