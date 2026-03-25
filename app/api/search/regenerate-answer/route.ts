import { NextRequest } from "next/server";
import { regenerateEnvelopes, streamAnswer, buildAnswerMessages } from "@/lib/search";
import { MODELS, estimateCost } from "@/lib/openrouter";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, { maxRequests: 5, windowMs: 60_000, prefix: "regen" });
  if (limited) return limited;

  try {
    const body = await request.json();
    const { verdict_ids, query, answer_model, verdict_count } = body as {
      verdict_ids: number[];
      query: string;
      answer_model?: string;
      verdict_count: number;
    };

    if (!verdict_ids || !Array.isArray(verdict_ids) || verdict_ids.length === 0) {
      return new Response(JSON.stringify({ error: "verdict_ids required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "query required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const selectedModel = answer_model || MODELS.ANSWER_GENERATION;
    const count = Math.min(verdict_count || 15, verdict_ids.length, 100);

    // Scale token budgets with verdict count
    // Real envelopes are ~6-8K tokens each (matched chunks + sentencja + fakty + rozważania)
    const tokenBudget = count * 10_000;
    const maxOutputTokens = Math.min(Math.max(8_000, count * 500), 32_000);

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
          // Build envelopes for the requested verdicts
          const topIds = verdict_ids.slice(0, count);
          const envelopes = await regenerateEnvelopes(topIds, tokenBudget);

          if (envelopes.length === 0) {
            send("error", { message: "No envelopes could be built" });
            controller.close();
            return;
          }

          // Tell client how many verdicts were actually included
          send("status", {
            envelopes_built: envelopes.length,
            requested: count,
          });

          // Stream the answer
          const answerStart = Date.now();
          const { stream: llmStream } = await streamAnswer(
            query, query, envelopes, selectedModel, maxOutputTokens
          );

          const reader = llmStream.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let fullAnswer = "";
          let usageData: { prompt_tokens?: number; completion_tokens?: number; total_cost?: string } | null = null;

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
                // Capture usage from final chunk
                if (parsed.usage) {
                  usageData = parsed.usage;
                }
              } catch {
                // skip
              }
            }
          }

          const inputTokens = usageData?.prompt_tokens || 0;
          const outputTokens = usageData?.completion_tokens || 0;
          const costUsd = parseFloat(usageData?.total_cost || "0")
            || estimateCost(selectedModel, inputTokens, outputTokens);

          send("done", {
            ai_overview: fullAnswer,
            envelopes_used: envelopes.length,
            answer_prompt: buildAnswerMessages(query, query, envelopes),
            metadata: {
              time_ms: Date.now() - answerStart,
              tokens_used: inputTokens + outputTokens,
              cost_usd: costUsd,
              costs: [{
                layer: "regeneration",
                model: selectedModel,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                cost_usd: costUsd,
                latency_ms: Date.now() - answerStart,
              }],
            },
          });
        } catch (err) {
          send("error", {
            message: err instanceof Error ? err.message : "Regeneration failed",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
