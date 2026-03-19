import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFolderAccess, hasAccess } from "@/lib/folders";
import { rateLimit } from "@/lib/rate-limit";
import { chatCompletion, MODELS } from "@/lib/openrouter";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Generate a 1-sentence Polish summary of a verdict for folder context.
 * Fetches the sentencja chunk (or first chunk as fallback), calls Gemini Flash Lite.
 * Returns null on any failure (graceful degradation).
 */
async function generateVerdictSummary(
  supabase: SupabaseClient,
  verdictId: number
): Promise<string | null> {
  try {
    // Fetch verdict metadata
    const { data: verdict } = await supabase
      .from("verdicts")
      .select("document_type, decision_type, metadata_json")
      .eq("id", verdictId)
      .single();

    // Fetch sentencja chunk, fall back to first chunk
    let { data: chunk } = await supabase
      .from("chunks")
      .select("chunk_text")
      .eq("verdict_id", verdictId)
      .eq("section_label", "sentencja")
      .limit(1)
      .single();

    if (!chunk) {
      const { data: firstChunk } = await supabase
        .from("chunks")
        .select("chunk_text")
        .eq("verdict_id", verdictId)
        .order("chunk_position", { ascending: true })
        .limit(1)
        .single();
      chunk = firstChunk;
    }

    if (!chunk?.chunk_text) return null;

    // Truncate to ~600 words to keep costs minimal
    const words = chunk.chunk_text.split(/\s+/);
    const text = words.slice(0, 600).join(" ");

    // Build structured context from metadata
    const meta = verdict?.metadata_json || {};
    const metaLines: string[] = [];
    if (verdict?.document_type) metaLines.push(`Typ: ${verdict.document_type}`);
    if (verdict?.decision_type) metaLines.push(`Rozstrzygnięcie: ${verdict.decision_type}`);
    if (meta.contracting_authority) metaLines.push(`Zamawiający: ${meta.contracting_authority}`);
    if (meta.subject_matters) metaLines.push(`Przedmiot: ${(meta.subject_matters as string[]).join(", ")}`);

    const metaBlock = metaLines.length > 0 ? `\nMetadane:\n${metaLines.join("\n")}\n` : "";

    const result = await chatCompletion(
      [
        {
          role: "system",
          content: `Jesteś asystentem prawnym. Na podstawie sentencji orzeczenia KIO i metadanych napisz JEDNO zdanie po polsku (maks. 25 słów) wg schematu:

"Odwołanie [kogo] w sprawie zamówienia [zamawiającego] dotyczące [czego — krótko przedmiot sporu]."

Zasady:
- Zacznij od typu sprawy (Odwołanie/Skarga/Wniosek).
- Podaj odwołującego się (kto wniósł) jeśli znany, w przeciwnym razie pomiń.
- Podaj zamawiającego jeśli znany, w przeciwnym razie pomiń.
- Zakończ krótkim opisem przedmiotu sporu (np. "dotyczące opisu przedmiotu zamówienia", "dotyczące wykluczenia wykonawcy").
- Pisz zwięźle, rzeczowo, bez zbędnych słów. Jedno zdanie, bez kropki na końcu.`,
        },
        {
          role: "user",
          content: `${metaBlock}\nSentencja:\n${text}`,
        },
      ],
      MODELS.ANSWER_GENERATION_FAST,
      { temperature: 0.1, max_tokens: 80 }
    );

    // Clean up: remove trailing period, trim
    let summary = result.content.trim();
    if (summary.endsWith(".")) summary = summary.slice(0, -1);
    return summary || null;
  } catch {
    return null;
  }
}

// GET — list items in folder with verdict metadata
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, { maxRequests: 60, windowMs: 60_000, prefix: "folder-items" });
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

  // Fetch items
  const { data: items, error: itemsError } = await supabase
    .from("folder_items")
    .select("*")
    .eq("folder_id", folderId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  if (!items || items.length === 0) {
    return NextResponse.json({ items: [] });
  }

  // Fetch verdict details for all items
  const verdictIds = items.map((i) => i.verdict_id);
  const { data: verdicts } = await supabase
    .from("verdicts")
    .select("id, sygnatura, verdict_date, document_type_normalized, decision_type_normalized")
    .in("id", verdictIds);

  const verdictMap = new Map(
    (verdicts || []).map((v) => [v.id, v])
  );

  // Fetch note counts per item
  const itemIds = items.map((i) => i.id);
  const { data: noteCounts } = await supabase
    .from("folder_notes")
    .select("item_id")
    .in("item_id", itemIds);

  const noteCountMap = new Map<number, number>();
  for (const n of noteCounts || []) {
    noteCountMap.set(n.item_id, (noteCountMap.get(n.item_id) || 0) + 1);
  }

  // Fetch tags per item
  const { data: itemTagRows } = await supabase
    .from("folder_item_tags")
    .select("item_id, tag_id, folder_tags(id, name, color)")
    .in("item_id", itemIds);

  const itemTagsMap = new Map<number, Array<{ id: number; name: string; color: string }>>();
  for (const row of itemTagRows || []) {
    const tag = (row as Record<string, unknown>).folder_tags as { id: number; name: string; color: string } | null;
    if (!tag) continue;
    if (!itemTagsMap.has(row.item_id)) {
      itemTagsMap.set(row.item_id, []);
    }
    itemTagsMap.get(row.item_id)!.push(tag);
  }

  const enrichedItems = items.map((item) => {
    const verdict = verdictMap.get(item.verdict_id);
    return {
      id: item.id,
      folder_id: item.folder_id,
      verdict_id: item.verdict_id,
      position: item.position,
      added_from: item.added_from,
      added_by: item.added_by,
      created_at: item.created_at,
      sygnatura: verdict?.sygnatura || "?",
      verdict_date: verdict?.verdict_date || null,
      document_type_normalized: verdict?.document_type_normalized || null,
      decision_type_normalized: verdict?.decision_type_normalized || null,
      summary: item.summary || null,
      tags: itemTagsMap.get(item.id) || [],
      note_count: noteCountMap.get(item.id) || 0,
    };
  });

  return NextResponse.json({ items: enrichedItems });
}

// POST — add verdict(s) to folder
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, { maxRequests: 30, windowMs: 60_000, prefix: "folder-items-add" });
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

  if (!folder || !hasAccess(access, "read_write")) {
    return NextResponse.json({ error: "Brak uprawnień do dodawania orzeczeń." }, { status: 403 });
  }

  const body = await request.json();
  const { verdict_ids, added_from, note } = body;

  if (!Array.isArray(verdict_ids) || verdict_ids.length === 0) {
    return NextResponse.json({ error: "Brak orzeczeń do dodania." }, { status: 400 });
  }
  if (verdict_ids.length > 100) {
    return NextResponse.json({ error: "Maksymalnie 100 orzeczeń na raz." }, { status: 400 });
  }

  // Validate verdict IDs exist
  const { data: existingVerdicts } = await supabase
    .from("verdicts")
    .select("id")
    .in("id", verdict_ids);

  const validIds = new Set((existingVerdicts || []).map((v) => v.id));

  // Get current max position
  const { data: maxPosRow } = await supabase
    .from("folder_items")
    .select("position")
    .eq("folder_id", folderId)
    .order("position", { ascending: false })
    .limit(1)
    .single();

  let nextPos = (maxPosRow?.position ?? -1) + 1;

  const added: number[] = [];
  const skipped: number[] = [];

  for (const vid of verdict_ids) {
    if (!validIds.has(vid)) {
      skipped.push(vid);
      continue;
    }

    const { error: insertError } = await supabase
      .from("folder_items")
      .insert({
        folder_id: folderId,
        verdict_id: vid,
        position: nextPos,
        added_from: added_from || null,
        added_by: user.id,
      });

    if (insertError) {
      // Unique constraint violation = already exists
      if (insertError.code === "23505") {
        skipped.push(vid);
      } else {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    } else {
      added.push(vid);
      nextPos++;

      // Get the newly created item's id
      const { data: newItem } = await supabase
        .from("folder_items")
        .select("id")
        .eq("folder_id", folderId)
        .eq("verdict_id", vid)
        .single();

      if (newItem) {
        // Generate 1-sentence summary (non-blocking for the insert, but we await it for the response)
        const summary = await generateVerdictSummary(supabase, vid);
        if (summary) {
          await supabase
            .from("folder_items")
            .update({ summary })
            .eq("id", newItem.id);
        }

        // If a note was provided, create it on the new item
        if (note && typeof note === "string" && note.trim()) {
          await supabase.from("folder_notes").insert({
            folder_id: folderId,
            item_id: newItem.id,
            author_id: user.id,
            content: note.trim(),
          });
        }
      }
    }
  }

  return NextResponse.json({ added, skipped, total_items: folder.item_count + added.length });
}
