import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFolderAccess, hasAccess } from "@/lib/folders";
import { rateLimit } from "@/lib/rate-limit";
import { chatCompletionStream, estimateCost } from "@/lib/openrouter";
import { buildAnalysisFollowUpMessages, buildAnalysisContext, buildAnalysisMessages } from "@/lib/analysis";

const MAX_EXCHANGES = 20;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; analysisId: string }> }
) {
  const limited = rateLimit(request, { maxRequests: 20, windowMs: 60_000, prefix: "analysis-chat" });
  if (limited) return limited;

  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id, analysisId } = await params;
  const folderId = parseInt(id, 10);
  const analysisIdNum = parseInt(analysisId, 10);

  if (isNaN(folderId) || isNaN(analysisIdNum)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { message } = body as { message: string };

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    if (message.length > 2000) {
      return NextResponse.json({ error: "Message too long (max 2000 characters)" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { folder, access } = await getFolderAccess(supabase, folderId, user.id);

    if (!folder || !hasAccess(access, "read")) {
      return NextResponse.json({ error: "Nie znaleziono teczki." }, { status: 404 });
    }

    // Load analysis
    const { data: analysis, error: analysisError } = await supabase
      .from("folder_analyses")
      .select("id, result, status, model, analysis_context, questions, template, verdict_ids")
      .eq("id", analysisIdNum)
      .eq("folder_id", folderId)
      .single();

    if (analysisError || !analysis) {
      return NextResponse.json({ error: "Nie znaleziono analizy." }, { status: 404 });
    }

    if (!analysis.result || analysis.status !== "completed") {
      return NextResponse.json({ error: "Analiza nie jest zakończona." }, { status: 400 });
    }

    // Fallback: rebuild context for old analyses created before this feature
    let analysisContext = analysis.analysis_context as string | null;
    if (!analysisContext) {
      const contexts = await buildAnalysisContext(
        supabase,
        analysis.verdict_ids as number[],
        folderId,
        true
      );
      const msgs = buildAnalysisMessages(
        analysis.questions as string[],
        (analysis.template as string | null) || null,
        contexts
      );
      const userMsg = msgs.find(m => m.role === "user");
      analysisContext = userMsg?.content || null;

      // Cache it for next time
      if (analysisContext) {
        supabase.from("folder_analyses")
          .update({ analysis_context: analysisContext })
          .eq("id", analysisIdNum)
          .then(({ error }) => {
            if (error) console.error("Failed to cache analysis context:", error);
          });
      }
    }

    if (!analysisContext) {
      return NextResponse.json({ error: "Brak kontekstu analizy do rozmowy." }, { status: 400 });
    }

    // Load existing conversation
    const { data: existingMessages } = await supabase
      .from("analysis_conversations")
      .select("ordinal, role, content")
      .eq("analysis_id", analysisIdNum)
      .order("ordinal", { ascending: true });

    const history = existingMessages || [];

    if (history.length >= MAX_EXCHANGES * 2) {
      return NextResponse.json({ error: "Limit rozmowy osiągnięty (max 20 wymian)." }, { status: 400 });
    }

    const answerModel = analysis.model || "anthropic/claude-sonnet-4.6";
    const conversationHistory = history.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
    }));

    const messages = buildAnalysisFollowUpMessages(
      analysisContext,
      analysis.result,
      conversationHistory,
      message.trim(),
      answerModel,
    );

    const nextOrdinal = history.length > 0
      ? Math.max(...history.map(m => m.ordinal as number)) + 1
      : 1;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          } catch { /* Client disconnected */ }
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
              } catch { /* skip */ }
            }
          }

          const latencyMs = Date.now() - answerStart;
          const inputTokens = usageData?.prompt_tokens || 0;
          const outputTokens = usageData?.completion_tokens || 0;
          const cacheReadTokens = usageData?.cache_read_input_tokens || 0;
          const costUsd = parseFloat(usageData?.total_cost || "0")
            || estimateCost(answerModel, inputTokens, outputTokens, cacheReadTokens);

          // Save messages
          await supabase.from("analysis_conversations").insert({
            analysis_id: analysisIdNum,
            ordinal: nextOrdinal,
            role: "user",
            content: message.trim(),
          });

          await supabase.from("analysis_conversations").insert({
            analysis_id: analysisIdNum,
            ordinal: nextOrdinal + 1,
            role: "assistant",
            content: fullAnswer,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cost_usd: costUsd,
            latency_ms: latencyMs,
            model: answerModel,
          });

          // Update analysis totals
          const { error: rpcError } = await supabase.rpc("increment_analysis_costs", {
            p_analysis_id: analysisIdNum,
            p_tokens: inputTokens + outputTokens,
            p_cost: costUsd,
          });
          if (rpcError) console.error("Failed to update analysis costs:", rpcError);

          // Cost log
          supabase.from("api_cost_log").insert({
            search_id: null,
            layer: "analysis_follow_up",
            model: answerModel,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cost_usd: costUsd,
            latency_ms: latencyMs,
          }).then(({ error }) => {
            if (error) console.error("Failed to save analysis chat cost log:", error);
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
          console.error("Analysis follow-up error:", err);
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
    console.error("Analysis chat request error:", error);
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
