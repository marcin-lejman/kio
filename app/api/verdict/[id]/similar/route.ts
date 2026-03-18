import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";

// Section weights for scoring target chunks
const SECTION_WEIGHTS: Record<string, number> = {
  uzasadnienie_rozważania: 1.0,
  uzasadnienie: 0.9,
  uzasadnienie_fakty: 0.6,
  sentencja: 0.4,
  content: 0.3,
  full_document: 0.3,
  koszty: 0.2,
  header: 0.2,
};

function getSectionWeight(label: string): number {
  if (label in SECTION_WEIGHTS) return SECTION_WEIGHTS[label];
  if (
    label.startsWith("uzasadnienie_zarzut_") ||
    label.startsWith("uzasadnienie_ad_")
  ) {
    return 1.0;
  }
  return 0.2;
}

interface SimilarChunkRow {
  chunk_id: number;
  verdict_id: number;
  section_label: string;
  similarity: number;
  sygnatura: string;
  verdict_date: string;
  document_type_normalized: string;
  decision_type_normalized: string;
  chunk_snippet: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, {
    maxRequests: 30,
    windowMs: 60_000,
    prefix: "similar",
  });
  if (limited) return limited;

  const { id } = await params;
  const verdictId = parseInt(id, 10);

  if (isNaN(verdictId)) {
    return NextResponse.json({ error: "Invalid verdict ID" }, { status: 400 });
  }

  try {
    const supabase = createServerClient();

    // Step 1: Fetch source verdict's reasoning chunk embeddings
    let { data: sourceChunks } = await supabase
      .from("chunks")
      .select("id, section_label, embedding")
      .eq("verdict_id", verdictId)
      .or(
        "section_label.like.uzasadnienie_rozważania%," +
          "section_label.like.uzasadnienie_zarzut_%," +
          "section_label.like.uzasadnienie_ad_%"
      )
      .not("embedding", "is", null);

    // Fallback for tier B: undifferentiated uzasadnienie
    if (!sourceChunks || sourceChunks.length === 0) {
      const { data: fallbackChunks } = await supabase
        .from("chunks")
        .select("id, section_label, embedding")
        .eq("verdict_id", verdictId)
        .eq("section_label", "uzasadnienie")
        .not("embedding", "is", null);

      if (!fallbackChunks || fallbackChunks.length === 0) {
        return NextResponse.json({ similar: [] });
      }
      sourceChunks = fallbackChunks;
    }

    // Cap at 5 source chunks
    const selected = sourceChunks.slice(0, 5);

    // Step 2: Query similar chunks in parallel
    const rpcPromises = selected.map(async (source) => {
      const { data, error } = await supabase.rpc("find_similar_chunks", {
        query_embedding: source.embedding,
        exclude_verdict_id: verdictId,
        match_threshold: 0.45,
        match_count: 20,
      });
      if (error) {
        console.error("find_similar_chunks error:", error);
        return [];
      }
      return (data || []) as SimilarChunkRow[];
    });

    const results = await Promise.all(rpcPromises);
    const allResults = results.flat();

    // Step 3: Group by verdict, apply section-weighted scoring
    const verdictMap = new Map<
      number,
      {
        verdict_id: number;
        sygnatura: string;
        verdict_date: string;
        document_type_normalized: string;
        decision_type_normalized: string;
        weighted_sims: number[];
        best_weighted_sim: number;
        best_section: string;
        best_snippet: string;
      }
    >();

    for (const row of allResults) {
      const weight = getSectionWeight(row.section_label);
      const weightedSim = row.similarity * weight;

      const existing = verdictMap.get(row.verdict_id);
      if (existing) {
        existing.weighted_sims.push(weightedSim);
        if (weightedSim > existing.best_weighted_sim) {
          existing.best_weighted_sim = weightedSim;
          existing.best_section = row.section_label;
          existing.best_snippet = row.chunk_snippet;
        }
      } else {
        verdictMap.set(row.verdict_id, {
          verdict_id: row.verdict_id,
          sygnatura: row.sygnatura,
          verdict_date: row.verdict_date,
          document_type_normalized: row.document_type_normalized,
          decision_type_normalized: row.decision_type_normalized,
          weighted_sims: [weightedSim],
          best_weighted_sim: weightedSim,
          best_section: row.section_label,
          best_snippet: row.chunk_snippet,
        });
      }
    }

    // score = max(weighted_sims) * 0.7 + mean(top_3) * 0.3
    const scored = Array.from(verdictMap.values()).map((v) => {
      const sorted = v.weighted_sims.sort((a, b) => b - a);
      const maxSim = sorted[0];
      const top3 = sorted.slice(0, 3);
      const meanTop3 = top3.reduce((s, x) => s + x, 0) / top3.length;

      return {
        verdict_id: v.verdict_id,
        sygnatura: v.sygnatura,
        verdict_date: v.verdict_date,
        document_type_normalized: v.document_type_normalized,
        decision_type_normalized: v.decision_type_normalized,
        score: maxSim * 0.7 + meanTop3 * 0.3,
        best_matching_section: v.best_section,
        snippet: v.best_snippet,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    return NextResponse.json({ similar: scored.slice(0, 10) });
  } catch (error) {
    console.error("Similar verdicts error:", error);
    return NextResponse.json(
      { error: "Failed to find similar verdicts" },
      { status: 500 }
    );
  }
}
