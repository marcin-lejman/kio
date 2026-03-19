import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFolderAccess, hasAccess } from "@/lib/folders";
import { rateLimit } from "@/lib/rate-limit";
import { chatCompletionStream, MODELS, estimateCost } from "@/lib/openrouter";
import { buildAnalysisContext, buildAnalysisMessages, buildSygnaturaMap } from "@/lib/analysis";

// GET — list analyses for folder
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, { maxRequests: 30, windowMs: 60_000, prefix: "folder-analyses" });
  if (limited) return limited;

  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id } = await params;
  const folderId = parseInt(id, 10);
  if (isNaN(folderId)) {
    return NextResponse.json({ error: "Invalid folder ID" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { folder, access } = await getFolderAccess(supabase, folderId, user.id);

  if (!folder || !hasAccess(access, "read")) {
    return NextResponse.json({ error: "Nie znaleziono teczki." }, { status: 404 });
  }

  const { data: analyses, error } = await supabase
    .from("folder_analyses")
    .select("*")
    .eq("folder_id", folderId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ analyses: analyses || [] });
}

// POST — create analysis with SSE streaming
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, { maxRequests: 5, windowMs: 60_000, prefix: "folder-analyses-create" });
  if (limited) return limited;

  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id } = await params;
  const folderId = parseInt(id, 10);
  if (isNaN(folderId)) {
    return new Response(JSON.stringify({ error: "Invalid folder ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createAdminClient();
  const { folder, access } = await getFolderAccess(supabase, folderId, user.id);

  if (!folder || !hasAccess(access, "read_write")) {
    return new Response(JSON.stringify({ error: "Brak uprawnień." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json();
  const { title, questions, template, verdict_ids, include_notes } = body;

  // Validation
  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return new Response(JSON.stringify({ error: "Tytuł analizy jest wymagany." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    return new Response(JSON.stringify({ error: "Przynajmniej jedno pytanie jest wymagane." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!Array.isArray(verdict_ids) || verdict_ids.length === 0) {
    return new Response(JSON.stringify({ error: "Wybierz przynajmniej jedno orzeczenie." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (verdict_ids.length > 15) {
    return new Response(JSON.stringify({ error: "Maksymalnie 15 orzeczeń na analizę." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify verdict_ids are in this folder
  const { data: folderItems } = await supabase
    .from("folder_items")
    .select("verdict_id")
    .eq("folder_id", folderId)
    .in("verdict_id", verdict_ids);

  const validIds = new Set((folderItems || []).map((fi) => fi.verdict_id));
  const invalidIds = verdict_ids.filter((vid: number) => !validIds.has(vid));
  if (invalidIds.length > 0) {
    return new Response(JSON.stringify({ error: "Niektóre orzeczenia nie należą do tej teczki." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Create analysis row
  const model = MODELS.ANSWER_GENERATION;
  const { data: analysis, error: insertError } = await supabase
    .from("folder_analyses")
    .insert({
      folder_id: folderId,
      title: title.trim(),
      questions,
      template: template || null,
      verdict_ids,
      status: "running",
      model,
      created_by: user.id,
    })
    .select()
    .single();

  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const analysisId = analysis.id;
  const startTime = Date.now();

  // SSE stream
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
        // Step 1: Build context
        send("status", { step: "building_context" });
        const contexts = await buildAnalysisContext(
          supabase,
          verdict_ids,
          folderId,
          include_notes !== false
        );

        // Build messages
        const messages = buildAnalysisMessages(questions, template || null, contexts);
        const sygnaturaMap = buildSygnaturaMap(contexts);

        // Step 2: Stream LLM response
        send("status", { step: "analyzing" });
        const { stream: llmStream, startTime: llmStart } = await chatCompletionStream(
          messages,
          model,
          { temperature: 0.2, max_tokens: 12_000 }
        );

        const reader = llmStream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullResult = "";
        let tokensUsed = 0;
        let costUsd = 0;

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
                fullResult += token;
                send("token", token);
              }

              if (parsed.usage) {
                const usage = parsed.usage;
                tokensUsed = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
                costUsd = parseFloat(usage.total_cost || "0") ||
                  estimateCost(model, usage.prompt_tokens || 0, usage.completion_tokens || 0);
              }
            } catch {
              // skip unparseable lines
            }
          }
        }

        const latencyMs = Date.now() - llmStart;

        // Update analysis row
        await supabase
          .from("folder_analyses")
          .update({
            result: fullResult,
            status: "completed",
            tokens_used: tokensUsed,
            cost_usd: costUsd,
            completed_at: new Date().toISOString(),
          })
          .eq("id", analysisId);

        // Log cost (non-critical)
        try {
          await supabase.from("api_cost_log").insert({
            search_id: null,
            layer: "folder_analysis",
            model,
            input_tokens: tokensUsed > 0 ? Math.round(tokensUsed * 0.9) : 0,
            output_tokens: tokensUsed > 0 ? Math.round(tokensUsed * 0.1) : 0,
            cost_usd: costUsd,
            latency_ms: latencyMs,
          });
        } catch { /* non-critical */ }

        send("done", {
          analysis_id: analysisId,
          result: fullResult,
          sygnatura_map: sygnaturaMap,
          metadata: {
            tokens_used: tokensUsed,
            cost_usd: costUsd,
            latency_ms: latencyMs,
          },
        });
      } catch (error) {
        console.error("Analysis error:", error);

        // Update row as error
        await supabase
          .from("folder_analyses")
          .update({
            status: "error",
            error_message: error instanceof Error ? error.message : "Unknown error",
          })
          .eq("id", analysisId);

        send("error", {
          message: error instanceof Error ? error.message : "Błąd generowania analizy.",
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
}
