import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFolderAccess, hasAccess } from "@/lib/folders";

// GET — single analysis
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; analysisId: string }> }
) {
  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id, analysisId } = await params;
  const folderId = parseInt(id, 10);
  const analysisIdNum = parseInt(analysisId, 10);
  if (isNaN(folderId) || isNaN(analysisIdNum)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { folder, access } = await getFolderAccess(supabase, folderId, user.id);

  if (!folder || !hasAccess(access, "read")) {
    return NextResponse.json({ error: "Nie znaleziono teczki." }, { status: 404 });
  }

  const { data: analysis, error } = await supabase
    .from("folder_analyses")
    .select("*")
    .eq("id", analysisIdNum)
    .eq("folder_id", folderId)
    .single();

  if (error || !analysis) {
    return NextResponse.json({ error: "Nie znaleziono analizy." }, { status: 404 });
  }

  // Load follow-up conversation messages
  const { data: conversations } = await supabase
    .from("analysis_conversations")
    .select("ordinal, role, content, cost_usd, input_tokens, output_tokens, latency_ms, created_at")
    .eq("analysis_id", analysisIdNum)
    .order("ordinal", { ascending: true });

  // Build sygnatura map for verdict linking
  let sygnaturaMap: Record<string, number> = {};
  if (analysis.verdict_ids && analysis.verdict_ids.length > 0) {
    const { data: verdicts } = await supabase
      .from("verdicts")
      .select("id, sygnatura")
      .in("id", analysis.verdict_ids);
    if (verdicts) {
      for (const v of verdicts) {
        sygnaturaMap[v.sygnatura] = v.id;
        sygnaturaMap[v.sygnatura.replace(/\s+/g, " ").trim()] = v.id;
      }
    }
  }

  return NextResponse.json({ ...analysis, conversations: conversations || [], sygnatura_map: sygnaturaMap });
}

// DELETE — delete analysis
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; analysisId: string }> }
) {
  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id, analysisId } = await params;
  const folderId = parseInt(id, 10);
  const analysisIdNum = parseInt(analysisId, 10);
  if (isNaN(folderId) || isNaN(analysisIdNum)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { folder, access } = await getFolderAccess(supabase, folderId, user.id);

  if (!folder || !hasAccess(access, "read_write")) {
    return NextResponse.json({ error: "Brak uprawnień." }, { status: 403 });
  }

  const { error } = await supabase
    .from("folder_analyses")
    .delete()
    .eq("id", analysisIdNum)
    .eq("folder_id", folderId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
