import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { chatCompletion, MODELS } from "@/lib/openrouter";
import { rateLimit } from "@/lib/rate-limit";

const SUMMARY_PROMPT = `Jesteś asystentem prawnym specjalizującym się w zamówieniach publicznych. Na podstawie dostarczonego wyroku KIO przygotuj zwięzłe podsumowanie w języku polskim, dokładnie 300 słów (±20), według poniższego szablonu. Używaj języka rzeczowego, bez ocen i komentarzy.

## SZABLON PODSUMOWANIA

**Przedmiot zamówienia:** [1-2 zdania: co jest zamawiane, tryb, wartość jeśli podana]

**Rozstrzygnięcie:** [uwzględniono/oddalono odwołanie + zwięzły opis nakazanych czynności]

**Zarzuty odwołującego:**
- [zarzut 1 — wskazać naruszony przepis + krótki opis]
- [zarzut 2 — j.w.]

**Stan faktyczny (kluczowe ustalenia):**
- [fakt 1]
- [fakt 2]
- [kolejne istotne fakty, liczby, kwoty, terminy]

**Uzasadnienie Izby (ratio decidendi):**
[2-4 zdania: główna linia argumentacji Izby, powołane przepisy, kluczowe tezy prawne]

**Powołane orzecznictwo i doktryna:**
- [sygnatura/autor — 1-zdaniowy opis tezy, jeśli występują]

**Znaczenie praktyczne:**
[1-2 zdania: w jakich sytuacjach ten wyrok może być przydatny jako argument]

## ZASADY
1. Trzymaj się ściśle treści wyroku — nie dodawaj informacji spoza dokumentu.
2. Kwoty podawaj z dokładnością do pełnych złotych.
3. Przepisy cytuj w formacie: art. X ust. Y pkt Z ustawy Pzp (lub innej właściwej ustawy).
4. Jeśli wyrok dotyczy tylko części zamówienia, wskaż której.
5. W sekcji "Znaczenie praktyczne" skup się na typie problemu prawnego, nie na konkretnych stronach.
6. Unikaj powtórzeń między sekcjami.`;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, {
    maxRequests: 60,
    windowMs: 60_000,
    prefix: "summary",
  });
  if (limited) return limited;

  const { id } = await params;
  const verdictId = parseInt(id, 10);
  if (isNaN(verdictId)) {
    return NextResponse.json({ error: "Invalid verdict ID" }, { status: 400 });
  }

  try {
    const supabase = createServerClient();
    const { data } = await supabase
      .from("verdict_summaries")
      .select("summary")
      .eq("verdict_id", verdictId)
      .single();

    return NextResponse.json({ summary: data?.summary ?? null });
  } catch (error) {
    console.error("Summary fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch summary" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = rateLimit(request, {
    maxRequests: 5,
    windowMs: 60_000,
    prefix: "summary-gen",
  });
  if (limited) return limited;

  const { id } = await params;
  const verdictId = parseInt(id, 10);
  if (isNaN(verdictId)) {
    return NextResponse.json({ error: "Invalid verdict ID" }, { status: 400 });
  }

  try {
    const supabase = createServerClient();

    // Check if summary already exists (idempotent)
    const { data: existing } = await supabase
      .from("verdict_summaries")
      .select("summary")
      .eq("verdict_id", verdictId)
      .single();

    if (existing?.summary) {
      return NextResponse.json({ summary: existing.summary });
    }

    // Fetch verdict text
    const { data: verdict, error: verdictError } = await supabase
      .from("verdicts")
      .select("original_text")
      .eq("id", verdictId)
      .single();

    if (verdictError || !verdict?.original_text) {
      return NextResponse.json(
        { error: "Verdict text not available" },
        { status: 400 }
      );
    }

    // Generate summary via LLM
    const result = await chatCompletion(
      [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: verdict.original_text },
      ],
      MODELS.ANSWER_GENERATION_FAST,
      { temperature: 0.1, max_tokens: 2048 }
    );

    const summary = result.content;

    // Save to database
    const { error: insertError } = await supabase
      .from("verdict_summaries")
      .insert({ verdict_id: verdictId, summary });

    if (insertError) {
      // UNIQUE violation = concurrent request already saved it
      if (insertError.code === "23505") {
        const { data: saved } = await supabase
          .from("verdict_summaries")
          .select("summary")
          .eq("verdict_id", verdictId)
          .single();
        return NextResponse.json({ summary: saved?.summary ?? summary });
      }
      console.error("Summary insert error:", insertError);
    }

    // Log cost
    await supabase.from("api_cost_log").insert({
      search_id: null,
      layer: "summary_generation",
      model: result.model,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      cost_usd: result.cost_usd,
      latency_ms: result.latency_ms,
    });

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("Summary generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate summary" },
      { status: 500 }
    );
  }
}
