import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage } from "@/lib/openrouter";

// ── Types ──

export interface AnalysisVerdictContext {
  verdict_id: number;
  sygnatura: string;
  verdict_date: string;
  document_type_normalized: string;
  decision_type_normalized: string;
  sentencja: string | null;
  fakty: string[];
  rozważania: string[];
  user_notes: string[];
  item_summary: string | null;
}

// ── Token estimation (matches ingest.py heuristic) ──

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.5);
}

// ── Context builder ──

const TOKEN_BUDGET = 60_000;
const PER_VERDICT_BUDGET = 4_000;
const SENTENCJA_BUDGET = 1_000;
const FAKTY_BUDGET = 1_200;
const ROZWAŻANIA_BUDGET = 1_200;

function truncateToTokens(text: string, budget: number): string {
  const words = text.split(/\s+/);
  const estimatedWords = Math.floor(budget / 1.5);
  if (words.length <= estimatedWords) return text;
  return words.slice(0, estimatedWords).join(" ") + "...";
}

export async function buildAnalysisContext(
  supabase: SupabaseClient,
  verdictIds: number[],
  folderId: number,
  includeNotes: boolean
): Promise<AnalysisVerdictContext[]> {
  // Fetch verdict metadata
  const { data: verdicts } = await supabase
    .from("verdicts")
    .select("id, sygnatura, verdict_date, document_type_normalized, decision_type_normalized")
    .in("id", verdictIds);

  const verdictMap = new Map(
    (verdicts || []).map((v) => [v.id, v])
  );

  // Fetch chunks for all verdicts (sentencja, fakty, rozważania)
  const { data: chunks } = await supabase
    .from("chunks")
    .select("verdict_id, section_label, chunk_position, chunk_text")
    .in("verdict_id", verdictIds)
    .in("section_label", [
      "sentencja",
      "uzasadnienie_fakty",
      "uzasadnienie_rozważania",
      "uzasadnienie", // fallback for tier B
    ])
    .order("chunk_position", { ascending: true });

  // Group chunks by verdict
  const chunksByVerdict = new Map<number, typeof chunks>();
  for (const chunk of chunks || []) {
    if (!chunksByVerdict.has(chunk.verdict_id)) {
      chunksByVerdict.set(chunk.verdict_id, []);
    }
    chunksByVerdict.get(chunk.verdict_id)!.push(chunk);
  }

  // Fetch folder item summaries
  const { data: folderItems } = await supabase
    .from("folder_items")
    .select("verdict_id, summary")
    .eq("folder_id", folderId)
    .in("verdict_id", verdictIds);

  const summaryMap = new Map(
    (folderItems || []).map((fi) => [fi.verdict_id, fi.summary])
  );

  // Fetch user notes if requested
  let notesByVerdict = new Map<number, string[]>();
  if (includeNotes) {
    const { data: items } = await supabase
      .from("folder_items")
      .select("id, verdict_id")
      .eq("folder_id", folderId)
      .in("verdict_id", verdictIds);

    const itemIdToVerdictId = new Map(
      (items || []).map((i) => [i.id, i.verdict_id])
    );
    const itemIds = (items || []).map((i) => i.id);

    if (itemIds.length > 0) {
      const { data: notes } = await supabase
        .from("folder_notes")
        .select("item_id, content, author_id")
        .in("item_id", itemIds)
        .order("created_at", { ascending: true });

      // Get author emails
      const authorIds = [...new Set((notes || []).map((n) => n.author_id))];
      let emailMap = new Map<string, string>();
      if (authorIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", authorIds);
        emailMap = new Map((profiles || []).map((p) => [p.id, p.email]));
      }

      for (const note of notes || []) {
        const vid = itemIdToVerdictId.get(note.item_id);
        if (!vid) continue;
        if (!notesByVerdict.has(vid)) {
          notesByVerdict.set(vid, []);
        }
        const author = emailMap.get(note.author_id) || "?";
        notesByVerdict.get(vid)!.push(`(${author}): ${note.content}`);
      }
    }
  }

  // Build contexts with token budgets
  const contexts: AnalysisVerdictContext[] = [];

  for (const vid of verdictIds) {
    const verdict = verdictMap.get(vid);
    if (!verdict) continue;

    const verdictChunks = chunksByVerdict.get(vid) || [];

    // Extract sentencja
    const sentencjaChunk = verdictChunks.find((c) => c.section_label === "sentencja");
    const sentencja = sentencjaChunk
      ? truncateToTokens(sentencjaChunk.chunk_text, SENTENCJA_BUDGET)
      : null;

    // Extract fakty chunks
    const faktyChunks = verdictChunks
      .filter((c) => c.section_label === "uzasadnienie_fakty" || c.section_label === "uzasadnienie")
      .slice(0, 2);
    const fakty: string[] = [];
    let faktyTokens = 0;
    for (const fc of faktyChunks) {
      const tokens = estimateTokens(fc.chunk_text);
      if (faktyTokens + tokens > FAKTY_BUDGET) {
        fakty.push(truncateToTokens(fc.chunk_text, FAKTY_BUDGET - faktyTokens));
        break;
      }
      fakty.push(fc.chunk_text);
      faktyTokens += tokens;
    }

    // Extract rozważania chunks
    const rozważaniaChunks = verdictChunks
      .filter((c) => c.section_label === "uzasadnienie_rozważania")
      .slice(0, 2);
    const rozważania: string[] = [];
    let rozTokens = 0;
    for (const rc of rozważaniaChunks) {
      const tokens = estimateTokens(rc.chunk_text);
      if (rozTokens + tokens > ROZWAŻANIA_BUDGET) {
        rozważania.push(truncateToTokens(rc.chunk_text, ROZWAŻANIA_BUDGET - rozTokens));
        break;
      }
      rozważania.push(rc.chunk_text);
      rozTokens += tokens;
    }

    contexts.push({
      verdict_id: vid,
      sygnatura: verdict.sygnatura,
      verdict_date: verdict.verdict_date,
      document_type_normalized: verdict.document_type_normalized,
      decision_type_normalized: verdict.decision_type_normalized,
      sentencja,
      fakty,
      rozważania,
      user_notes: notesByVerdict.get(vid) || [],
      item_summary: summaryMap.get(vid) || null,
    });
  }

  return contexts;
}

// ── Prompt ──

const ANALYSIS_PROMPT = `ROLA: Jesteś ekspertem prawa zamówień publicznych przeprowadzającym pogłębioną analizę wybranych orzeczeń KIO.

ZADANIE: Na podstawie WYŁĄCZNIE dostarczonych orzeczeń KIO, przeprowadź analizę zgodnie z pytaniami użytkownika. Analiza dotyczy KONKRETNEGO ZBIORU orzeczeń wybranych przez użytkownika — nie jest to wyszukiwanie, lecz praca analityczna nad materiałem.

BEZWZGLĘDNY ZAKAZ: NIE stosuj żadnych elementów odgrywania roli, fikcyjnych ram narracyjnych ani konwencji korespondencji. Zakazane są: nagłówki typu "Notatka służbowa", "Memo", "Szanowny Partnerze", zwroty grzecznościowe, podpisy, daty, adresy, nagłówki "Do/Od". Zacznij BEZPOŚREDNIO od merytorycznej analizy.

FORMAT MATERIAŁU ŹRÓDŁOWEGO:
Materiał jest pogrupowany PO ORZECZENIACH. Każde orzeczenie zawiera:
- [SENTENCJA] — rozstrzygnięcie Izby.
- [STAN FAKTYCZNY] — fragmenty uzasadnienia opisujące okoliczności sprawy.
- [ROZWAŻANIA] — fragmenty uzasadnienia prawnego Izby.
- [NOTATKI UŻYTKOWNIKA] — notatki dodane przez prawników pracujących nad sprawą. Wykorzystaj je jako kontekst wskazujący, na co użytkownik zwraca uwagę, ale NIE traktuj ich jako źródła prawnego.
- [STRESZCZENIE] — krótkie podsumowanie orzeczenia.

TRYBY ANALIZY (wybierz na podstawie pytań użytkownika):

Jeśli pytania dotyczą PORÓWNANIA LINII ORZECZNICZYCH:
- Zidentyfikuj główne stanowiska/tezy prawne w orzeczeniach.
- Pogrupuj orzeczenia według stanowisk — wyraźnie wskaż, które orzeczenia prezentują spójne, a które rozbieżne poglądy.
- Dla każdego stanowiska przytocz kluczową argumentację Izby z cytowaniem sygnatur.
- Wskaż ewolucję czasową — jeśli starsze orzeczenia prezentują inne stanowisko niż nowsze.
- Podsumuj, które stanowisko dominuje i jaki jest obecny trend orzeczniczy.

Jeśli pytania dotyczą SPRZECZNOŚCI:
- Porównuj WYŁĄCZNIE tezy prawne i argumentację, nie stany faktyczne.
- Dla każdej sprzeczności wskaż: (a) konkretne orzeczenia, (b) przeciwstawne tezy, (c) kluczowe różnice w argumentacji.
- Rozróżniaj sprzeczności pozorne (wynikające z różnic w stanach faktycznych) od rzeczywistych.

Jeśli pytania dotyczą WSPÓLNYCH PODSTAW PRAWNYCH:
- Wylistuj konkretne przepisy (artykuły ustawy Pzp, rozporządzeń, dyrektyw UE).
- Przy każdym przepisie wskaż, w ilu i których orzeczeniach się pojawia.
- Zidentyfikuj najczęściej powoływane przepisy i kontekst ich zastosowania.

Jeśli pytania dotyczą PODSUMOWANIA DLA KLIENTA:
- Pisz językiem zrozumiałym dla niespecjalisty, unikaj żargonu prawniczego lub objaśniaj go.
- Skup się na praktycznych implikacjach.
- Struktura: (1) główny wniosek, (2) krótkie omówienie najważniejszych orzeczeń, (3) rekomendacje praktyczne.

Jeśli pytania są NIESTANDARDOWE:
- Odpowiadaj na pytania użytkownika, opierając się wyłącznie na dostarczonym materiale.

ZASADY:
1. Opieraj się WYŁĄCZNIE na dostarczonych fragmentach orzeczeń. Nie uzupełniaj wiedzą ogólną.
2. Jeśli fragment jest niejasny lub niepełny — zaznacz to wprost.
3. NIE łącz tez z różnych orzeczeń w sposób sugerujący jednorodną linię orzeczniczą, jeśli dotyczą różnych stanów faktycznych.
4. Wykorzystaj WSZYSTKIE orzeczenia — jeśli jakieś nie pasuje do pytania, wskaż to explicite.
5. Jeśli notatki użytkownika wskazują na konkretne zagadnienia — zwróć na nie szczególną uwagę.

CYTOWANIE:
6. Każde twierdzenie o stanowisku Izby MUSI zawierać sygnaturę w formacie [KIO XXXX/XX].
7. BEZWZGLĘDNY ZAKAZ cytowania sygnatur spoza sekcji „BIAŁA LISTA SYGNATUR".
8. Przepisuj sygnatury DOKŁADNIE z białej listy.
9. Cytaty dosłowne oznaczaj cudzysłowami „...".

STRUKTURA ODPOWIEDZI:
10. Zacznij od 2-3 zdań podsumowujących główny wniosek.
11. Przedstaw szczegółową analizę, pogrupowaną tematycznie (NIE po orzeczeniach osobno).
12. Zakończ syntetycznym podsumowaniem.
13. Jeśli materiał nie pozwala na pełną odpowiedź, wskaż luki.

STYL:
14. Pisz po polsku, językiem prawniczym ale komunikatywnym.
15. Unikaj ogólników — precyzyjnie oddawaj skalę materiału (np. "2 z 8 analizowanych orzeczeń" zamiast "część orzeczeń").
16. Odpowiedź powinna być wyczerpująca — to nie streszczenie, lecz analiza.`;

// ── Message builder ──

export function buildAnalysisMessages(
  questions: string[],
  template: string | null,
  contexts: AnalysisVerdictContext[]
): ChatMessage[] {
  // Build user message
  const parts: string[] = [];

  // Questions
  parts.push("PYTANIA ANALITYCZNE:");
  questions.forEach((q, i) => parts.push(`${i + 1}. ${q}`));
  if (template) {
    parts.push(`\nSZABLON ANALIZY: ${template}`);
  }
  parts.push("");

  // Verdict blocks
  for (const ctx of contexts) {
    parts.push(`=== Orzeczenie: ${ctx.sygnatura} (${ctx.document_type_normalized || "?"}, ${ctx.verdict_date || "?"}, ${ctx.decision_type_normalized || "?"}) ===`);

    if (ctx.item_summary) {
      parts.push(`\n[STRESZCZENIE]\n${ctx.item_summary}`);
    }

    if (ctx.sentencja) {
      parts.push(`\n[SENTENCJA]\n${ctx.sentencja}`);
    }

    if (ctx.fakty.length > 0) {
      parts.push(`\n[STAN FAKTYCZNY]\n${ctx.fakty.join("\n\n")}`);
    }

    if (ctx.rozważania.length > 0) {
      parts.push(`\n[ROZWAŻANIA]\n${ctx.rozważania.join("\n\n")}`);
    }

    if (ctx.user_notes.length > 0) {
      parts.push(`\n[NOTATKI UŻYTKOWNIKA]`);
      ctx.user_notes.forEach((n) => parts.push(`• ${n}`));
    }

    parts.push("");
  }

  // Whitelist
  parts.push("========================================");
  parts.push("BIAŁA LISTA SYGNATUR — JEDYNE sygnatury, które możesz cytować:");
  for (const ctx of contexts) {
    parts.push(`• ${ctx.sygnatura}`);
  }
  parts.push("========================================");
  parts.push("UWAGA: Jakiekolwiek odwołanie do sygnatury SPOZA powyższej listy jest niedopuszczalne.");

  return [
    { role: "system", content: ANALYSIS_PROMPT },
    { role: "user", content: parts.join("\n") },
  ];
}

// ── Sygnatura map builder ──

export function buildSygnaturaMap(contexts: AnalysisVerdictContext[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const ctx of contexts) {
    // Normalize: "KIO 3297/23" -> verdict_id
    map[ctx.sygnatura] = ctx.verdict_id;
    // Also handle spacing variants
    const normalized = ctx.sygnatura.replace(/\s+/g, " ").trim();
    map[normalized] = ctx.verdict_id;
  }
  return map;
}
