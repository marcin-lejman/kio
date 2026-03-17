import { NextRequest } from "next/server";
import { searchBase, streamAnswer, type CostEntry } from "@/lib/search";
import { createServerClient } from "@/lib/supabase";
import { MODELS, estimateCost } from "@/lib/openrouter";
import { rateLimit } from "@/lib/rate-limit";
import type { SearchFilters } from "@/lib/search";

export async function POST(request: NextRequest) {
  // 10 searches per minute per IP to prevent OpenRouter quota abuse
  const limited = rateLimit(request, { maxRequests: 10, windowMs: 60_000, prefix: "search" });
  if (limited) return limited;

  try {
    const body = await request.json();
    const { query, filters, answer_model } = body as {
      query: string;
      filters?: SearchFilters;
      answer_model?: string;
    };

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Query is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (query.length > 1000) {
      return new Response(
        JSON.stringify({ error: "Query too long (max 1000 characters)" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const selectedModel = answer_model || MODELS.ANSWER_GENERATION;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        }

        try {
          // Layers 1-2: search + rank (inside stream so we can emit status events)
          const base = await searchBase(query.trim(), filters, (status) => {
            send("status", { step: status });
          });

          // Send search results immediately
          send("results", {
            query: base.query,
            verdicts: base.verdicts,
            sygnatura_map: base.sygnatura_map,
            debug: base.debug,
            metadata: {
              time_ms: Date.now() - base.startTime,
              tokens_used: base.totalTokens,
              cost_usd: base.costs.reduce((s, c) => s + c.cost_usd, 0),
              costs: base.costs,
            },
          });

          // Layer 3: stream AI answer
          if (base.fusedChunks.length > 0) {
            try {
              const { stream: llmStream, startTime: answerStart } =
                await streamAnswer(base.query, base.semanticQuery, base.fusedChunks, selectedModel);

              const reader = llmStream.getReader();
              const decoder = new TextDecoder();
              let buffer = "";
              let fullAnswer = "";

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                  if (!line.startsWith("data: ")) continue;
                  const data = line.slice(6);
                  if (data === "[DONE]") continue;

                  try {
                    const parsed = JSON.parse(data);
                    const token = parsed.choices?.[0]?.delta?.content;
                    if (token) {
                      fullAnswer += token;
                      send("token", token);
                    }

                    if (parsed.usage) {
                      const usage = parsed.usage;
                      const answerCost: CostEntry = {
                        layer: "answer_generation",
                        model: selectedModel,
                        input_tokens: usage.prompt_tokens || 0,
                        output_tokens: usage.completion_tokens || 0,
                        cost_usd:
                          parseFloat(usage.total_cost || "0") || estimateCost(selectedModel, usage.prompt_tokens || 0, usage.completion_tokens || 0),
                        latency_ms: Date.now() - answerStart,
                      };
                      base.costs.push(answerCost);
                      base.totalTokens +=
                        (usage.prompt_tokens || 0) +
                        (usage.completion_tokens || 0);
                    }
                  } catch {
                    // skip unparseable SSE lines
                  }
                }
              }

              // Validate and fix sygnatura references in the AI answer
              const { fixed, unresolved } = validateSygnaturaRefs(fullAnswer, base.sygnatura_map);
              if (unresolved.length > 0) {
                console.warn("Unresolvable sygnatura refs in AI answer:", unresolved);
              }

              const finalMetadata = {
                time_ms: Date.now() - base.startTime,
                tokens_used: base.totalTokens,
                cost_usd: base.costs.reduce((s, c) => s + c.cost_usd, 0),
                costs: base.costs,
              };

              // Save to database and get the search_id
              const searchId = await saveSearchHistory({
                query: base.query,
                filters: filters || null,
                verdicts: base.verdicts,
                sygnatura_map: base.sygnatura_map,
                debug: base.debug,
                ai_overview: fixed,
                ai_overview_status: "verified",
                answer_model: selectedModel,
                metadata: finalMetadata,
              });

              send("done", {
                ai_overview: fixed,
                metadata: finalMetadata,
                search_id: searchId,
                unresolved_refs: unresolved.length > 0 ? unresolved : undefined,
              });

              saveCostLog(base.costs, searchId).catch((err) =>
                console.error("Failed to save cost log:", err)
              );
            } catch (error) {
              console.error("AI generation error:", error);
              send("error", { message: "AI generation failed" });
            }
          } else {
            const finalMetadata = {
              time_ms: Date.now() - base.startTime,
              tokens_used: base.totalTokens,
              cost_usd: base.costs.reduce((s, c) => s + c.cost_usd, 0),
              costs: base.costs,
            };

            const searchId = await saveSearchHistory({
              query: base.query,
              filters: filters || null,
              verdicts: base.verdicts,
              sygnatura_map: base.sygnatura_map,
              debug: base.debug,
              ai_overview: null,
              ai_overview_status: "verified",
              answer_model: selectedModel,
              metadata: finalMetadata,
            });

            send("done", {
              ai_overview: null,
              metadata: finalMetadata,
              search_id: searchId,
            });
          }
        } catch (error) {
          console.error("Search error:", error);
          send("error", { message: "Search failed. Please try again." });
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Request parsing error:", error);
    return new Response(
      JSON.stringify({ error: "Invalid request" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Extract all individual KIO references from a string.
 * Matches "KIO" followed by digits/slash patterns like "KIO 3297/23".
 * Returns array of { ref, start, end } for each match.
 */
function extractKioRefs(text: string): { ref: string; start: number; end: number }[] {
  const results: { ref: string; start: number; end: number }[] = [];
  const pattern = /KIO\s+\d+\/\d+/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    results.push({ ref: match[0], start: match.index, end: match.index + match[0].length });
  }
  return results;
}

/**
 * Validate and normalize all KIO sygnatura references in the AI answer.
 *
 * Strategy: process every [...] bracket group and every bare KIO reference
 * individually. This avoids the old approach where one malformed ref inside
 * a bracket group would cause the entire group (including valid refs) to be
 * invisible to the regex.
 *
 * For each individual KIO ref found anywhere in the text:
 * - If it resolves in sygnaturaMap → ensure it's in [brackets]
 * - If it doesn't resolve → leave as plain text, add to unresolved list
 */
/**
 * Normalize a sygnatura string for matching: collapse all whitespace around
 * digits and slashes so "KIO 58 /11" and "KIO 58/11" both become "KIO 58/11".
 */
function normalizeSygnatura(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/").trim();
}

function validateSygnaturaRefs(
  answer: string,
  sygnaturaMap: Record<string, number>
): { fixed: string; unresolved: string[] } {
  const unresolved: string[] = [];

  // Build a normalized lookup: "KIO 58/11" -> verdict_id, preserving original keys
  // so we can resolve regardless of spacing differences.
  const normalizedMap = new Map<string, number>();
  for (const [key, value] of Object.entries(sygnaturaMap)) {
    normalizedMap.set(normalizeSygnatura(key), value);
  }

  function resolves(ref: string): boolean {
    return normalizedMap.has(normalizeSygnatura(ref));
  }

  // Step 1: Process bracket groups — extract, validate, rebuild.
  // Match any [...] that contains at least one "KIO" reference.
  const bracketPattern = /\[([^\]]*KIO[^\]]*)\]/g;
  let processed = answer.replace(bracketPattern, (_fullMatch, inner: string) => {
    const refs = extractKioRefs(inner);
    if (refs.length === 0) return _fullMatch; // no KIO refs, leave as-is

    const resolvable: string[] = [];
    const notResolvable: string[] = [];

    for (const { ref } of refs) {
      const normalized = normalizeSygnatura(ref);
      if (resolves(normalized)) {
        resolvable.push(normalized);
      } else {
        notResolvable.push(normalized);
        unresolved.push(normalized);
      }
    }

    if (resolvable.length > 0 && notResolvable.length === 0) {
      return `[${resolvable.join(", ")}]`;
    }
    if (resolvable.length > 0 && notResolvable.length > 0) {
      return `[${resolvable.join(", ")}], ${notResolvable.join(", ")}`;
    }
    // None resolve — return as plain text (no brackets)
    return notResolvable.join(", ");
  });

  // Step 2: Find bare KIO refs (outside brackets) and wrap resolvable ones.
  // Build a set of positions already inside brackets to skip them.
  const bracketRanges: { start: number; end: number }[] = [];
  const bracketScan = /\[[^\]]*\]/g;
  let bm;
  while ((bm = bracketScan.exec(processed)) !== null) {
    bracketRanges.push({ start: bm.index, end: bm.index + bm[0].length });
  }

  function isInsideBracket(pos: number): boolean {
    return bracketRanges.some(r => pos >= r.start && pos < r.end);
  }

  const bareRefs = extractKioRefs(processed);
  // Process from end to start so replacements don't shift indices
  for (let i = bareRefs.length - 1; i >= 0; i--) {
    const { ref, start, end } = bareRefs[i];
    if (isInsideBracket(start)) continue; // already in brackets

    const normalized = normalizeSygnatura(ref);
    if (resolves(normalized)) {
      // Wrap in brackets
      processed = processed.slice(0, start) + `[${normalized}]` + processed.slice(end);
    } else {
      unresolved.push(normalized);
    }
  }

  return { fixed: processed, unresolved: [...new Set(unresolved)] };
}

async function saveSearchHistory(result: {
  query: string;
  filters: SearchFilters | null;
  verdicts: { verdict_id: number }[];
  sygnatura_map: Record<string, number>;
  debug: unknown;
  ai_overview: string | null;
  ai_overview_status: string;
  answer_model: string;
  metadata: { time_ms: number; tokens_used: number; cost_usd: number; costs: unknown[] };
}): Promise<number | null> {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("search_history")
      .insert({
        query: result.query,
        filters: result.filters,
        result_count: result.verdicts.length,
        result_ids: result.verdicts.map((v) => v.verdict_id),
        ai_answer: result.ai_overview,
        ai_status: result.ai_overview_status,
        answer_model: result.answer_model,
        tokens_used: result.metadata.tokens_used,
        cost_usd: result.metadata.cost_usd,
        latency_ms: result.metadata.time_ms,
        result_data: {
          verdicts: result.verdicts,
          sygnatura_map: result.sygnatura_map,
          debug: result.debug,
          metadata: result.metadata,
        },
      })
      .select("id")
      .single();

    if (error) {
      console.error("Failed to save search history:", error);
      return null;
    }
    return data.id;
  } catch (err) {
    console.error("Failed to save search history:", err);
    return null;
  }
}

async function saveCostLog(costs: CostEntry[], searchId: number | null) {
  if (costs.length === 0) return;
  const supabase = createServerClient();
  await supabase.from("api_cost_log").insert(
    costs.map((c) => ({
      search_id: searchId,
      layer: c.layer,
      model: c.model,
      input_tokens: c.input_tokens,
      output_tokens: c.output_tokens,
      cost_usd: c.cost_usd,
      latency_ms: c.latency_ms,
    }))
  );
}
