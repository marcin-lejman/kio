import { createServerClient } from "./supabase";
import { chatCompletion, chatCompletionStream, embedText, MODELS, type LLMResponse } from "./openrouter";

// ============================================================
// Types
// ============================================================

export interface SearchFilters {
  document_type?: string;
  decision_type?: string;
  date_from?: string;
  date_to?: string;
}

export interface QueryUnderstanding {
  keywords: string[];
  semantic_query: string;
  filters: SearchFilters;
}

export interface ChunkResult {
  chunk_id: number;
  verdict_id: number;
  section_label: string;
  chunk_position: number;
  total_chunks: number;
  preamble: string;
  chunk_text: string;
  score: number;        // normalized 0-1 after fusion
  source: "vector" | "fts" | "both";
  sygnatura: string;
  verdict_date: string;
  document_type: string;
  document_type_normalized: string;
  decision_type: string;
  decision_type_normalized: string;
  chunking_tier: string;
}

export interface VerdictResult {
  verdict_id: number;
  sygnatura: string;
  verdict_date: string;
  document_type: string;
  document_type_normalized: string;
  decision_type: string;
  decision_type_normalized: string;
  relevance_score: number;
  matching_passages: {
    chunk_text: string;
    section_label: string;
    score: number;
  }[];
}

export interface SearchResponse {
  query: string;
  ai_overview: string | null;
  ai_overview_status: "verified" | "sources_only" | "error";
  sygnatura_map: Record<string, number>;
  verdicts: VerdictResult[];
  debug?: {
    raw_answer: string | null;
    query_understanding: QueryUnderstanding | null;
  };
  metadata: {
    time_ms: number;
    tokens_used: number;
    cost_usd: number;
    costs: CostEntry[];
  };
}

export interface CostEntry {
  layer: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
}

// ============================================================
// Layer 1: Query Understanding
// ============================================================

const QUERY_UNDERSTANDING_PROMPT = `Jesteś asystentem wyszukiwarki orzeczeń Krajowej Izby Odwoławczej (KIO) w zamówieniach publicznych.

Twoim zadaniem jest analiza zapytania użytkownika i wygenerowanie:
1. keywords — lista polskich słów kluczowych w WSZYSTKICH ważnych formach gramatycznych (mianownik, dopełniacz, celownik, biernik, narzędnik, miejscownik) oraz synonimy i powiązane terminy prawnicze. Generuj 10-30 form.
2. semantic_query — przeformułowane zapytanie semantyczne zoptymalizowane pod wyszukiwanie wektorowe w kontekście orzecznictwa KIO.
3. filters — opcjonalne filtry (document_type: "wyrok"|"postanowienie", decision_type: "oddalone"|"uwzglednione"|"umorzone"|"odrzucone", date_from, date_to w formacie YYYY-MM-DD).

PRZYKŁADY rozwinięcia słów kluczowych:

Zapytanie: "budowa drogi gminnej"
keywords: ["budowa", "budowy", "budową", "budowie", "budowę", "roboty budowlane", "robót budowlanych", "robotami budowlanymi", "droga", "drogi", "drogą", "drodze", "dróg", "drogowej", "drogowych", "gminna", "gminnej", "gminnych", "gminnym", "gminną", "inwestycja drogowa", "infrastruktura drogowa", "nawierzchnia"]

Zapytanie: "rażąco niska cena"
keywords: ["rażąco", "niska", "niskiej", "niską", "niskie", "cena", "ceny", "ceną", "cenie", "cenę", "cen", "rażąco niska cena", "rażąco niskiej ceny", "rażąco niską cenę", "wyjaśnienia ceny", "wyjaśnień ceny", "kosztorys", "kosztorysu", "kosztorysem", "wycena", "wyceny", "kalkulacja", "kalkulacji"]

Zapytanie: "wykluczenie wykonawcy"
keywords: ["wykluczenie", "wykluczenia", "wykluczeniem", "wykluczeniu", "wykluczonego", "wykluczyć", "wykonawca", "wykonawcy", "wykonawcę", "wykonawców", "wykonawcą", "podmiot", "konsorcjum", "przesłanki wykluczenia", "przesłanek wykluczenia", "podstawy wykluczenia", "JEDZ", "oświadczenie", "oświadczenia", "warunki udziału"]

Odpowiedz WYŁĄCZNIE prawidłowym JSON-em bez markdown, bez komentarzy:
{"keywords": [...], "semantic_query": "...", "filters": {}}`;

export async function queryUnderstanding(userQuery: string): Promise<{ result: QueryUnderstanding; cost: CostEntry }> {
  const response = await chatCompletion(
    [
      { role: "system", content: QUERY_UNDERSTANDING_PROMPT },
      { role: "user", content: userQuery },
    ],
    MODELS.QUERY_UNDERSTANDING,
    { temperature: 0.1, max_tokens: 1024 }
  );

  let parsed: QueryUnderstanding;
  try {
    parsed = JSON.parse(response.content);
  } catch {
    // Fallback: use the query as-is
    parsed = {
      keywords: userQuery.split(/\s+/).filter(w => w.length > 2),
      semantic_query: userQuery,
      filters: {},
    };
  }

  return {
    result: parsed,
    cost: {
      layer: "query_understanding",
      model: response.model,
      input_tokens: response.input_tokens,
      output_tokens: response.output_tokens,
      cost_usd: response.cost_usd,
      latency_ms: response.latency_ms,
    },
  };
}

// ============================================================
// Embedding + Database Search
// ============================================================

async function vectorSearch(
  embedding: number[],
  filters: SearchFilters,
  limit: number = 50
): Promise<ChunkResult[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: embedding,
    match_threshold: 0.25,
    match_count: limit,
    filter_type: filters.document_type || null,
    filter_decision: filters.decision_type || null,
    filter_date_from: filters.date_from || null,
    filter_date_to: filters.date_to || null,
  });

  if (error) throw new Error(`Vector search error: ${error.message}`);

  return (data || []).map((row: Record<string, unknown>) => ({
    chunk_id: row.chunk_id as number,
    verdict_id: row.verdict_id as number,
    section_label: row.section_label as string,
    chunk_position: row.chunk_position as number,
    total_chunks: row.total_chunks as number,
    preamble: row.preamble as string,
    chunk_text: row.chunk_text as string,
    score: row.similarity as number,
    source: "vector" as const,
    sygnatura: row.sygnatura as string,
    verdict_date: row.verdict_date as string,
    document_type: row.document_type as string,
    document_type_normalized: row.document_type_normalized as string,
    decision_type: row.decision_type as string,
    decision_type_normalized: row.decision_type_normalized as string,
    chunking_tier: row.chunking_tier as string,
  }));
}

function buildTsQuery(keywords: string[]): string {
  // For to_tsquery('simple', ...): each keyword must be a valid lexeme.
  // Multi-word keywords like "roboty budowlane" become "roboty <-> budowlane" (phrase/adjacent).
  // Single words stay as-is. All joined with | (OR).
  return keywords
    .map((kw) => {
      const words = kw.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) return null;
      // Sanitize: remove any tsquery special characters from individual words
      const clean = words.map((w) => w.replace(/[&|!<>():*\\]/g, ""));
      if (clean.length === 1) return clean[0];
      // Multi-word: use adjacency operator <->
      return clean.join(" <-> ");
    })
    .filter(Boolean)
    .join(" | ");
}

async function ftsSearch(
  keywords: string[],
  filters: SearchFilters,
  limit: number = 50
): Promise<ChunkResult[]> {
  const supabase = createServerClient();
  const searchQuery = buildTsQuery(keywords);

  const { data, error } = await supabase.rpc("search_chunks_fts", {
    search_query: searchQuery,
    match_count: limit,
    filter_type: filters.document_type || null,
    filter_decision: filters.decision_type || null,
    filter_date_from: filters.date_from || null,
    filter_date_to: filters.date_to || null,
  });

  if (error) throw new Error(`FTS search error: ${error.message}`);

  return (data || []).map((row: Record<string, unknown>) => ({
    chunk_id: row.chunk_id as number,
    verdict_id: row.verdict_id as number,
    section_label: row.section_label as string,
    chunk_position: row.chunk_position as number,
    total_chunks: row.total_chunks as number,
    preamble: row.preamble as string,
    chunk_text: row.chunk_text as string,
    score: row.rank as number,
    source: "fts" as const,
    sygnatura: row.sygnatura as string,
    verdict_date: row.verdict_date as string,
    document_type: row.document_type as string,
    document_type_normalized: row.document_type_normalized as string,
    decision_type: row.decision_type as string,
    decision_type_normalized: row.decision_type_normalized as string,
    chunking_tier: row.chunking_tier as string,
  }));
}

// ============================================================
// Layer 2: Reciprocal Rank Fusion
// ============================================================

function reciprocalRankFusion(
  vectorResults: ChunkResult[],
  ftsResults: ChunkResult[],
  k: number = 60,
  maxResults: number = 200
): ChunkResult[] {
  const scores = new Map<number, { score: number; chunk: ChunkResult; sources: Set<string> }>();

  // Score vector results
  vectorResults.forEach((chunk, rank) => {
    const rrfScore = 1 / (k + rank + 1);
    const existing = scores.get(chunk.chunk_id);
    if (existing) {
      existing.score += rrfScore;
      existing.sources.add("vector");
    } else {
      scores.set(chunk.chunk_id, { score: rrfScore, chunk, sources: new Set(["vector"]) });
    }
  });

  // Score FTS results
  ftsResults.forEach((chunk, rank) => {
    const rrfScore = 1 / (k + rank + 1);
    const existing = scores.get(chunk.chunk_id);
    if (existing) {
      existing.score += rrfScore;
      existing.sources.add("fts");
    } else {
      scores.set(chunk.chunk_id, { score: rrfScore, chunk, sources: new Set(["fts"]) });
    }
  });

  // Sort by fused score and take top N
  const sorted = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return sorted.map(({ score, chunk, sources }) => ({
    ...chunk,
    score,
    source: sources.size > 1 ? "both" as const : (sources.values().next().value as "vector" | "fts"),
  }));
}

// ============================================================
// Layer 2.5: LLM Reranking
// ============================================================

const RERANKING_PROMPT = `Oceń trafność każdego fragmentu orzeczenia KIO w odniesieniu do zapytania użytkownika.
Skup się na tym, czy fragment MERYTORYCZNIE dotyczy zagadnienia z zapytania — nie wystarczy samo wystąpienie słów kluczowych.

WAŻNE: Fragmenty orzeczeń KIO prawie zawsze dotyczą zamówień publicznych, więc pewien poziom powiązania jest naturalny. Oceniaj na tle KONKRETNEGO pytania użytkownika.

Skala 0-10:
- 0-1: zupełnie niezwiązany — fragment dotyczy całkowicie innego tematu
- 2-3: bardzo luźno powiązany — ten sam obszar prawa, ale inne zagadnienie
- 4-5: częściowo powiązany — dotyczy pokrewnego zagadnienia, wspomina temat pytania kontekstowo
- 6-7: powiązany — dotyczy tego samego zagadnienia prawnego, ale inny aspekt lub stan faktyczny
- 8-9: bezpośrednio trafny — omawia dokładnie zagadnienie z pytania
- 10: idealnie odpowiada — fragment wprost rozstrzyga kwestię postawioną w pytaniu

Większość fragmentów powinna otrzymać ocenę 3-7. Ocena 0 to absolutna ostateczność (np. fragment o robotach budowlanych przy pytaniu o usługi medyczne).

Odpowiedz WYŁĄCZNIE tablicą JSON z ocenami, np. [7, 4, 8, 3, ...]`;

async function rerankChunks(
  userQuery: string,
  chunks: ChunkResult[],
): Promise<{ reranked: ChunkResult[]; cost: CostEntry; scores: number[] }> {
  // Not enough chunks to bother reranking
  if (chunks.length < 5) {
    return {
      reranked: chunks,
      cost: { layer: "reranking", model: MODELS.QUERY_UNDERSTANDING, input_tokens: 0, output_tokens: 0, cost_usd: 0, latency_ms: 0 },
      scores: chunks.map(() => -1),
    };
  }

  const top = chunks.slice(0, 30);
  const fragmentList = top
    .map((c, i) => {
      const preview = c.chunk_text.slice(0, 400);
      const label = c.sygnatura.includes("|")
        ? c.sygnatura.split("|").map(s => s.trim()).join(", ")
        : c.sygnatura;
      return `${i + 1}. [${label}] (${c.section_label}): ${preview}`;
    })
    .join("\n\n");

  try {
    const response = await chatCompletion(
      [
        { role: "system", content: RERANKING_PROMPT },
        { role: "user", content: `Zapytanie: "${userQuery}"\n\nFragmenty (${top.length}):\n\n${fragmentList}` },
      ],
      MODELS.QUERY_UNDERSTANDING,
      { temperature: 0, max_tokens: 256 }
    );

    const cost: CostEntry = {
      layer: "reranking",
      model: response.model,
      input_tokens: response.input_tokens,
      output_tokens: response.output_tokens,
      cost_usd: response.cost_usd,
      latency_ms: response.latency_ms,
    };

    // Parse scores array from LLM response
    const cleaned = response.content.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    const scores = JSON.parse(cleaned) as number[];

    // Validate: must be an array with the right length
    if (!Array.isArray(scores) || scores.length !== top.length) {
      console.warn(`Reranking: expected ${top.length} scores, got ${scores.length}. Falling back to RRF order.`);
      return { reranked: chunks, cost, scores: chunks.map(() => -1) };
    }

    // Blend: weighted combination of RRF rank score and LLM relevance
    // RRF scores are tiny (~0.01-0.03), LLM scores are 0-10.
    // Normalize both to 0-1 range, then weight: 30% RRF + 70% LLM
    const maxRrf = Math.max(...top.map(c => c.score));
    const reranked = top.map((chunk, i) => {
      const llmScore = Math.max(0, Math.min(10, scores[i] ?? 0));
      const rrfNorm = maxRrf > 0 ? chunk.score / maxRrf : 0;
      const llmNorm = llmScore / 10;
      return {
        ...chunk,
        score: 0.3 * rrfNorm + 0.7 * llmNorm,
      };
    });

    // Sort by blended score descending
    reranked.sort((a, b) => b.score - a.score);

    // Append any remaining chunks (31+) that weren't reranked — give them a low blended score
    const remaining = chunks.slice(30).map(c => ({
      ...c,
      score: maxRrf > 0 ? 0.3 * (c.score / maxRrf) * 0.5 : 0,
    }));
    return { reranked: [...reranked, ...remaining], cost, scores };
  } catch (err) {
    console.warn("Reranking failed, falling back to RRF order:", err);
    return {
      reranked: chunks,
      cost: { layer: "reranking", model: MODELS.QUERY_UNDERSTANDING, input_tokens: 0, output_tokens: 0, cost_usd: 0, latency_ms: 0 },
      scores: chunks.map(() => -1),
    };
  }
}

// ============================================================
// Group chunks by verdict
// ============================================================

function groupByVerdict(chunks: ChunkResult[], maxVerdicts: number = 15): VerdictResult[] {
  const verdictMap = new Map<number, VerdictResult>();

  for (const chunk of chunks) {
    const existing = verdictMap.get(chunk.verdict_id);
    if (existing) {
      existing.matching_passages.push({
        chunk_text: chunk.chunk_text,
        section_label: chunk.section_label,
        score: chunk.score,
      });
      // Update relevance score (max of all chunks)
      existing.relevance_score = Math.max(existing.relevance_score, chunk.score);
    } else {
      verdictMap.set(chunk.verdict_id, {
        verdict_id: chunk.verdict_id,
        sygnatura: chunk.sygnatura,
        verdict_date: chunk.verdict_date,
        document_type: chunk.document_type,
        document_type_normalized: chunk.document_type_normalized,
        decision_type: chunk.decision_type,
        decision_type_normalized: chunk.decision_type_normalized,
        relevance_score: chunk.score,
        matching_passages: [
          {
            chunk_text: chunk.chunk_text,
            section_label: chunk.section_label,
            score: chunk.score,
          },
        ],
      });
    }
  }

  return Array.from(verdictMap.values())
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, maxVerdicts);
}

// ============================================================
// Layer 3: Answer Generation
// ============================================================

const ANSWER_GENERATION_PROMPT = `ROLA: Jesteś aplikantem radcowskim z 2-letnim doświadczeniem w zamówieniach publicznych, przygotowującym notatkę służbową dla partnera kancelarii na podstawie orzecznictwa KIO.

ZADANIE: Na podstawie WYŁĄCZNIE dostarczonych fragmentów orzeczeń KIO, przygotuj WYCZERPUJĄCĄ analizę prawną odpowiadającą na pytanie użytkownika.

ZASADY PRACY Z MATERIAŁEM ŹRÓDŁOWYM:
1. Opieraj się WYŁĄCZNIE na dostarczonych fragmentach. Nie uzupełniaj treści wiedzą ogólną, doktryną ani własnymi wnioskami wykraczającymi poza tekst fragmentów.
2. Jeśli fragment jest niejasny lub niepełny — zaznacz to wprost zamiast domyślać się intencji Izby.
3. Jeśli fragmenty nie pozwalają na pełną odpowiedź, napisz co z nich wynika i wyraźnie wskaż luki (np. "Dostępne fragmenty nie odnoszą się do kwestii X").
4. NIE łącz tez z różnych orzeczeń w sposób sugerujący, że Izba wypowiedziała się w danej sprawie kompleksowo, jeśli każde orzeczenie dotyczyło innego stanu faktycznego.
5. WYKORZYSTAJ MAKSYMALNIE wszystkie dostarczone fragmenty, które są merytorycznie powiązane z zapytaniem semantycznym. Nie ograniczaj się do 2-3 fragmentów — jeśli 10 z 15 fragmentów zawiera istotne treści, omów je wszystkie. Celem jest KOMPLEKSOWE pokrycie dostępnego materiału, nie streszczenie kilku wybranych orzeczeń. Pomiń jedynie fragmenty ewidentnie nietrafione (np. dotyczące zupełnie innego zagadnienia).

CYTOWANIE I SYGNATURY:
6. Każde twierdzenie o stanowisku Izby MUSI zawierać odniesienie do konkretnego orzeczenia w formacie [KIO XXXX/XX].
7. BEZWZGLĘDNY ZAKAZ cytowania sygnatur spoza sekcji „BIAŁĄ LISTA SYGNATUR" w wiadomości użytkownika. To jest zamknięta, wyczerpująca lista — żadne inne sygnatury NIE ISTNIEJĄ. Nie wymyślaj, nie rekonstruuj z pamięci, nie zgaduj numerów. Jeśli nie ma sygnatury na białej liście, NIE MOŻESZ się do niej odwołać. Naruszenie tej zasady jest KRYTYCZNYM BŁĘDEM.
8. Przepisuj sygnatury z białej listy DOKŁADNIE — nie zmieniaj, nie łącz, nie skracaj numerów.
9. Cytaty dosłowne z fragmentów oznaczaj cudzysłowami „...". Cytuj dosłownie TYLKO gdy precyzyjne sformułowanie Izby ma znaczenie dla argumentacji. W pozostałych przypadkach parafrazuj.
10. Każdy cytat dosłowny musi być możliwy do zweryfikowania w dostarczonym fragmencie — nie rekonstruuj cytatów z pamięci.

STRUKTURA ODPOWIEDZI:
11. Zacznij od 1-2 zdań podsumowujących główny wniosek wynikający z analizowanych orzeczeń.
12. Następnie przedstaw stanowiska z poszczególnych orzeczeń, wskazując — tam gdzie to istotne — kontekst faktyczny sprawy (jaki był przedmiot zamówienia, czego dotyczył zarzut).
13. Jeśli orzeczenia prezentują rozbieżne stanowiska, wyraźnie to zaznacz.
14. Zakończ krótką oceną przydatności dostępnego materiału dla pytania użytkownika (np. "Powyższe orzeczenia dotyczą bezpośrednio problematyki X" lub "Fragmenty dotyczą pokrewnych zagadnień, ale nie odpowiadają wprost na pytanie o Y").

STYL:
15. Pisz po polsku, językiem prawniczym ale komunikatywnym — jak w notatce wewnętrznej kancelarii, nie jak w podręczniku.
16. Unikaj ogólników typu "Izba wielokrotnie podkreślała" jeśli masz tylko 1-2 orzeczenia na dany temat. Precyzyjnie oddawaj skalę materiału.`;

/**
 * Build the list of individual citable sygnaturas from chunks.
 * Splits pipe-separated sygnaturas into individual parts.
 */
function normalizeSygnatura(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/").trim();
}

function buildCitableList(chunks: ChunkResult[]): string[] {
  const set = new Set<string>();
  for (const c of chunks.slice(0, 15)) {
    if (c.sygnatura.includes("|")) {
      for (const part of c.sygnatura.split("|")) {
        const normalized = normalizeSygnatura(part);
        if (normalized) set.add(normalized);
      }
    } else {
      set.add(normalizeSygnatura(c.sygnatura));
    }
  }
  return [...set];
}

function buildAnswerContext(chunks: ChunkResult[]): string {
  return chunks
    .slice(0, 15)
    .map((c, i) => {
      // For pipe-separated sygnaturas, show individual parts to the AI
      const label = c.sygnatura.includes("|")
        ? c.sygnatura.split("|").map(s => s.trim()).join(", ")
        : c.sygnatura;
      return `--- Fragment ${i + 1} [${label}] (${c.section_label}) ---\n${c.chunk_text}`;
    })
    .join("\n\n");
}

function buildAnswerMessages(userQuery: string, semanticQuery: string, chunks: ChunkResult[]) {
  const context = buildAnswerContext(chunks);
  const citableList = buildCitableList(chunks);
  return [
    { role: "system" as const, content: ANSWER_GENERATION_PROMPT },
    {
      role: "user" as const,
      content: `Pytanie użytkownika: ${userQuery}\n\nZapytanie semantyczne: ${semanticQuery}\n\nFragmenty orzeczeń KIO:\n\n${context}\n\n========================================\nBIAŁA LISTA SYGNATUR — JEDYNE sygnatury, które możesz cytować:\n${citableList.map(s => `• ${s}`).join("\n")}\n========================================\nUWAGA: Jakiekolwiek odwołanie do sygnatury SPOZA powyższej listy jest niedopuszczalne.`,
    },
  ];
}

// ============================================================
// Search Base (Layers 1-2): returns results + chunks for streaming
// ============================================================

export interface SearchBaseResult {
  query: string;
  semanticQuery: string;
  verdicts: VerdictResult[];
  sygnatura_map: Record<string, number>;
  fusedChunks: ChunkResult[];
  costs: CostEntry[];
  totalTokens: number;
  startTime: number;
  debug: {
    query_understanding: QueryUnderstanding | null;
    fts_results: { sygnatura: string; section_label: string; score: number; chunk_text_preview: string }[];
    vector_results: { sygnatura: string; section_label: string; score: number; chunk_text_preview: string }[];
    fused_results: { sygnatura: string; section_label: string; score: number; source: string }[];
    reranked_results: { sygnatura: string; section_label: string; score: number; llm_score: number; original_rank: number }[];
    fts_query: string;
    answer_prompt: { role: string; content: string }[] | null;
  };
}

export async function searchBase(userQuery: string, filters?: SearchFilters): Promise<SearchBaseResult> {
  const startTime = Date.now();
  const costs: CostEntry[] = [];
  let totalTokens = 0;

  // Layer 1: Query Understanding
  const { result: understanding, cost: l1Cost } = await queryUnderstanding(userQuery);
  costs.push(l1Cost);
  totalTokens += l1Cost.input_tokens + l1Cost.output_tokens;

  // Merge user-provided filters with LLM-detected filters
  const mergedFilters: SearchFilters = {
    ...understanding.filters,
    ...filters,
  };

  // Embed the semantic query
  const embeddingStart = Date.now();
  const { embedding, tokens: embTokens, cost_usd: embCost } = await embedText(understanding.semantic_query);
  costs.push({
    layer: "embedding",
    model: MODELS.EMBEDDING,
    input_tokens: embTokens,
    output_tokens: 0,
    cost_usd: embCost,
    latency_ms: Date.now() - embeddingStart,
  });
  totalTokens += embTokens;

  // Parallel: vector search + FTS search
  const dbSearchStart = Date.now();
  const [vectorResults, ftsResults] = await Promise.all([
    vectorSearch(embedding, mergedFilters, 150),
    ftsSearch(understanding.keywords, mergedFilters, 150),
  ]);
  costs.push({
    layer: "db_search",
    model: "vector+fts",
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    latency_ms: Date.now() - dbSearchStart,
  });

  // Layer 2: Reciprocal Rank Fusion
  const fusedChunks = reciprocalRankFusion(vectorResults, ftsResults);

  // Layer 2.5: LLM Reranking
  const { reranked: rerankedChunks, cost: rerankCost, scores: rerankScores } =
    await rerankChunks(userQuery, fusedChunks);
  costs.push(rerankCost);
  totalTokens += rerankCost.input_tokens + rerankCost.output_tokens;

  const verdicts = groupByVerdict(rerankedChunks, 100);

  const sygnaturaMap: Record<string, number> = {};
  for (const v of verdicts) {
    const normalizedKey = normalizeSygnatura(v.sygnatura);
    sygnaturaMap[normalizedKey] = v.verdict_id;
    // For pipe-separated sygnaturas like "KIO 3800/23|KIO 3809/23",
    // also index each individual part so AI-generated references resolve
    if (v.sygnatura.includes("|")) {
      for (const part of v.sygnatura.split("|")) {
        const normalized = normalizeSygnatura(part);
        if (normalized && !(normalized in sygnaturaMap)) {
          sygnaturaMap[normalized] = v.verdict_id;
        }
      }
    }
  }

  const summarizeChunks = (chunks: ChunkResult[]) =>
    chunks.map((c) => ({
      sygnatura: c.sygnatura,
      section_label: c.section_label,
      score: c.score,
      chunk_text_preview: c.chunk_text.slice(0, 150),
    }));

  return {
    query: userQuery,
    semanticQuery: understanding.semantic_query,
    verdicts,
    sygnatura_map: sygnaturaMap,
    fusedChunks: rerankedChunks,
    costs,
    totalTokens,
    startTime,
    debug: {
      query_understanding: understanding,
      fts_results: summarizeChunks(ftsResults),
      vector_results: summarizeChunks(vectorResults),
      fused_results: fusedChunks.map((c) => ({
        sygnatura: c.sygnatura,
        section_label: c.section_label,
        score: c.score,
        source: c.source,
      })),
      reranked_results: rerankedChunks.slice(0, 30).map((c, i) => ({
        sygnatura: c.sygnatura,
        section_label: c.section_label,
        score: c.score,
        llm_score: rerankScores[fusedChunks.findIndex(fc => fc.chunk_id === c.chunk_id)] ?? -1,
        original_rank: fusedChunks.findIndex(fc => fc.chunk_id === c.chunk_id),
      })),
      fts_query: buildTsQuery(understanding.keywords),
      answer_prompt: rerankedChunks.length > 0 ? buildAnswerMessages(userQuery, understanding.semantic_query, rerankedChunks) : null,
    },
  };
}

// ============================================================
// Streaming answer generation
// ============================================================

export async function streamAnswer(
  userQuery: string,
  semanticQuery: string,
  chunks: ChunkResult[],
  answerModel: string,
): Promise<{ stream: ReadableStream<Uint8Array>; startTime: number }> {
  const messages = buildAnswerMessages(userQuery, semanticQuery, chunks);
  return chatCompletionStream(messages, answerModel, {
    temperature: 0.2,
    max_tokens: 8000,
  });
}
