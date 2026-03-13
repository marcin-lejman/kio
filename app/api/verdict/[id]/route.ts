import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { cleanVerdictHtml } from "@/lib/sanitize-html";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(_request, { maxRequests: 60, windowMs: 60_000, prefix: "verdict" });
  if (limited) return limited;

  const { id } = await params;
  const verdictId = parseInt(id, 10);

  if (isNaN(verdictId)) {
    return NextResponse.json({ error: "Invalid verdict ID" }, { status: 400 });
  }

  try {
    const supabase = createServerClient();

    // Get verdict details
    const { data: verdict, error: verdictError } = await supabase
      .from("verdicts")
      .select("*")
      .eq("id", verdictId)
      .single();

    if (verdictError || !verdict) {
      return NextResponse.json({ error: "Verdict not found" }, { status: 404 });
    }

    // Get all chunks for this verdict (ordered by position)
    const { data: chunks, error: chunksError } = await supabase
      .from("chunks")
      .select("id, section_label, chunk_position, total_chunks, preamble, chunk_text, word_count, token_count")
      .eq("verdict_id", verdictId)
      .order("chunk_position", { ascending: true });

    if (chunksError) {
      console.error("Chunks fetch error:", chunksError);
    }

    return NextResponse.json({
      verdict: {
        id: verdict.id,
        document_id: verdict.document_id,
        sygnatura: verdict.sygnatura,
        verdict_date: verdict.verdict_date,
        document_type: verdict.document_type,
        document_type_normalized: verdict.document_type_normalized,
        decision_type: verdict.decision_type,
        decision_type_normalized: verdict.decision_type_normalized,
        word_count: verdict.word_count,
        chunking_tier: verdict.chunking_tier,
        metadata: verdict.metadata_json,
        original_text: verdict.original_text,
        original_html: verdict.original_html ? cleanVerdictHtml(verdict.original_html) : null,
      },
      chunks: chunks || [],
    });
  } catch (error) {
    console.error("Verdict fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch verdict" },
      { status: 500 }
    );
  }
}
