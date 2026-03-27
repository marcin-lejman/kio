import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildFollowUpMessages, regenerateEnvelopes, buildAnswerContext, buildCitableList } from "@/lib/search";
import { chatCompletionStream, estimateCost } from "@/lib/openrouter";
import { rateLimit } from "@/lib/rate-limit";

const MAX_EXCHANGES = 20; // 20 user+assistant pairs = 40 rows

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, { maxRequests: 20, windowMs: 60_000, prefix: "chat" });
  if (limited) return limited;

  const { id } = await params;
  const searchId = parseInt(id, 10);

  if (isNaN(searchId)) {
    return new Response(JSON.stringify({ error: "Invalid search ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.json();
    const { message } = body as { message: string };

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (message.length > 2000) {
      return new Response(
        JSON.stringify({ error: "Message too long (max 2000 characters)" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabase = createAdminClient();

    // Load the search
    const { data: search, error: searchError } = await supabase
      .from("search_history")
      .select("id, query, ai_answer, ai_status, answer_model, result_data")
      .eq("id", searchId)
      .single();

    if (searchError || !search) {
      return new Response(JSON.stringify({ error: "Search not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!search.ai_answer) {
      return new Response(
        JSON.stringify({ error: "No AI overview available for follow-up" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Load existing conversation
    const { data: existingMessages } = await supabase
      .from("search_conversations")
      .select("ordinal, role, content")
      .eq("search_id", searchId)
      .order("ordinal", { ascending: true });

    const history = existingMessages || [];

    if (history.length >= MAX_EXCHANGES * 2) {
      return new Response(
        JSON.stringify({ error: "Conversation limit reached (max 20 exchanges)" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get or rebuild answer context
    const resultData = search.result_data as {
      verdicts?: { verdict_id: number }[];
      answer_context?: string;
      citable_list?: string[];
    } | null;

    let answerContext = resultData?.answer_context || "";
    let citableList = resultData?.citable_list || [];

    // Fallback for old searches without stored context
    if (!answerContext && resultData?.verdicts) {
      const verdictIds = resultData.verdicts.map(v => v.verdict_id);
      const envelopes = await regenerateEnvelopes(verdictIds, verdictIds.length * 10_000);
      answerContext = buildAnswerContext(envelopes);
      citableList = buildCitableList(envelopes);
    }

    if (!answerContext) {
      return new Response(
        JSON.stringify({ error: "Cannot rebuild context for follow-up" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const answerModel = search.answer_model || "anthropic/claude-sonnet-4.6";
    const conversationHistory = history.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
    }));

    const messages = buildFollowUpMessages(
      search.query,
      answerContext,
      citableList,
      search.ai_answer,
      conversationHistory,
      message.trim(),
      answerModel,
    );

    const nextOrdinal = history.length > 0
      ? Math.max(...history.map(m => m.ordinal as number)) + 1
      : 1;

    // Stream the response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          } catch {
            // Client disconnected
          }
        }

        try {
          const answerStart = Date.now();
          const { stream: llmStream } = await chatCompletionStream(messages, answerModel, {
            temperature: 0.2,
            max_tokens: 4000,
          });

          const reader = llmStream.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let fullAnswer = "";
          let usageData: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_cost?: string;
            cache_read_input_tokens?: number;
          } | null = null;

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
                  usageData = parsed.usage;
                }
              } catch {
                // skip unparseable SSE lines
              }
            }
          }

          const latencyMs = Date.now() - answerStart;
          const inputTokens = usageData?.prompt_tokens || 0;
          const outputTokens = usageData?.completion_tokens || 0;
          const cacheReadTokens = usageData?.cache_read_input_tokens || 0;
          const costUsd = parseFloat(usageData?.total_cost || "0")
            || estimateCost(answerModel, inputTokens, outputTokens, cacheReadTokens);

          // Save user message
          await supabase.from("search_conversations").insert({
            search_id: searchId,
            ordinal: nextOrdinal,
            role: "user",
            content: message.trim(),
          });

          // Save assistant message
          await supabase.from("search_conversations").insert({
            search_id: searchId,
            ordinal: nextOrdinal + 1,
            role: "assistant",
            content: fullAnswer,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cost_usd: costUsd,
            latency_ms: latencyMs,
            model: answerModel,
          });

          // Update search_history totals atomically
          const { error: rpcError } = await supabase.rpc("increment_search_costs", {
            p_search_id: searchId,
            p_tokens: inputTokens + outputTokens,
            p_cost: costUsd,
          });
          if (rpcError) {
            console.error("Failed to update search costs:", rpcError);
          }

          // Save to cost log
          supabase.from("api_cost_log").insert({
            search_id: searchId,
            layer: "follow_up_chat",
            model: answerModel,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cost_usd: costUsd,
            latency_ms: latencyMs,
          }).then(({ error }) => {
            if (error) console.error("Failed to save chat cost log:", error);
          });

          send("done", {
            content: fullAnswer,
            cost_usd: costUsd,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            latency_ms: latencyMs,
            cache_read_tokens: cacheReadTokens,
            follow_up_prompt: messages.map(m => ({ role: m.role, content: m.content })),
          });
        } catch (err) {
          console.error("Follow-up chat error:", err);
          send("error", {
            message: err instanceof Error ? err.message : "Failed to generate response",
          });
        }

        try { controller.close(); } catch { /* already closed */ }
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
    console.error("Chat request parsing error:", error);
    return new Response(
      JSON.stringify({ error: "Invalid request" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
}
