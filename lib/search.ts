import { createAdminClient } from "./supabase/admin";
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

export interface KeywordGroup {
  concept: string;
  forms: string[];
}

export interface QueryUnderstanding {
  keywords: string[];
  keyword_groups?: KeywordGroup[];
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
    chunk_position: number;
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
1. keyword_groups — lista GRUP pojęciowych. Każda grupa to jeden koncept z zapytania, z wariantami gramatycznymi i synonimy. Generuj 5-15 form na grupę. Każda grupa: {"concept": "nazwa_konceptu", "forms": ["forma1", "forma2", ...]}.
2. semantic_query — przeformułowane zapytanie semantyczne zoptymalizowane pod wyszukiwanie wektorowe w kontekście orzecznictwa KIO.
3. filters — opcjonalne filtry (document_type: "wyrok"|"postanowienie", decision_type: "oddalone"|"uwzglednione"|"umorzone"|"odrzucone", date_from, date_to w formacie YYYY-MM-DD).

ZASADY GRUPOWANIA:
- Każdy odrębny koncept/temat z zapytania = osobna grupa.
- Wyrażenia stanowiące JEDNĄ frazę prawniczą (np. "rażąco niska cena") to JEDNA grupa, nie trzy.
- Synonimy i terminy pokrewne wchodzą do grupy tego konceptu, który zastępują.

ZASADY GENEROWANIA FORM (KRYTYCZNE — od tego zależy jakość wyszukiwania):
Formy w grupie są wyszukiwane operatorem OR w indeksie pełnotekstowym. Grupy łączone są operatorem AND. Frazy wielowyrazowe wymagają dopasowania sąsiadujących słów, więc są BARDZO restrykcyjne. Dlatego:
- Każda grupa MUSI zawierać formy JEDNOWYRAZOWE — odmiany kluczowego słowa przez przypadki + synonimy jednowyrazowe. To są NAJWAŻNIEJSZE formy zapewniające trafienia.
- Frazy wielowyrazowe (maks. 3 wyrazy) to UZUPEŁNIENIE, NIE zamiennik form jednowyrazowych.
- NIGDY nie generuj grupy, w której WSZYSTKIE formy są wielowyrazowe — to powoduje brak wyników.
- NIGDY nie generuj fraz dłuższych niż 3 wyrazy (np. "naruszenie przepisów o wyborze trybu" — ZA DŁUGA, nie używaj).
- Dla konceptu-przymiotnika (np. "niewłaściwy"): formy jednowyrazowe to odmiany tego przymiotnika (niewłaściwy, niewłaściwego, niewłaściwym) + synonimy jednowyrazowe (wadliwy, nieprawidłowy, błędny).
- Dla konceptu-frazy (np. "rażąco niska cena"): formy to WYRÓŻNIAJĄCE słowa frazy odmienione jednowyrazowo (rażąco, rażąca) + pełne krótkie frazy (rażąco niska cena, rażąco niskiej ceny) + synonimy jednowyrazowe.
- Priorytet form: (1) odmiany jednowyrazowe kluczowych słów, (2) synonimy jednowyrazowe, (3) frazy 2-3 wyrazowe jako bonus.
- NIE dodawaj jako form jednowyrazowych OGÓLNYCH terminów prawnych, które występują w niemal każdym orzeczeniu KIO (np. "postępowanie", "zamawiający", "zamówienie", "oferta", "ustawa"). Takie terminy pasują do wszystkich dokumentów i powodują timeout wyszukiwania. Używaj ich WYŁĄCZNIE jako część fraz wielowyrazowych. Np. dla konceptu "tryb postępowania": generuj "tryb", "trybu", "trybem" ale NIE "postępowanie", "postępowania" osobno — zachowaj je w frazach "tryb postępowania".

ZASADY SEMANTIC_QUERY:
- Przeformułuj zapytanie jako 1-2 zdania opisujące istotę problemu prawnego.
- Używaj terminologii z orzecznictwa KIO i ustawy Pzp.
- Rozszerz o kontekst prawny (np. "wadium" → dodaj "art. 98 Pzp").
- NIE kopiuj zapytania użytkownika dosłownie.

ROZPOZNAWANIE FILTRÓW:
- "wyrok/wyroki" → document_type: "wyrok"
- "postanowienie" → document_type: "postanowienie"
- "uwzględnione/wygrane/korzystne" → decision_type: "uwzglednione"
- "oddalone/przegrane/niekorzystne" → decision_type: "oddalone"
- "umorzone" → decision_type: "umorzone"
- Daty: "z 2023 roku" → date_from: "2023-01-01", date_to: "2023-12-31"
- Brak wskazówek = nie ustawiaj filtra (puste {})

PRZYPADKI SZCZEGÓLNE:
- Zapytanie zawiera numer artykułu (np. "art. 226 ust. 1 pkt 5") → dodaj go do forms i semantic_query.
- Zapytanie jest zbyt ogólne (1 słowo ogólnikowe) → wygeneruj grupy najlepiej jak potrafisz, nie proś o doprecyzowanie.
- Zapytanie jest konwersacyjne (np. "co KIO mówi o...") → wyodrębnij koncepty prawne, ignoruj część konwersacyjną.

PRZYKŁADY:

Zapytanie: "wycofanie wadium"
keyword_groups: [
  {"concept": "wycofanie", "forms": ["wycofanie", "wycofania", "wycofaniu", "wycofać", "wycofał", "cofnięcie", "cofnięcia", "zwrot", "zwrotu", "zwrócenie"]},
  {"concept": "wadium", "forms": ["wadium", "wadiem", "wadialne", "zabezpieczenie wadialne", "zabezpieczenia wadialnego"]}
]

Zapytanie: "rażąco niska cena"
keyword_groups: [
  {"concept": "rażąco niska cena", "forms": ["rażąco", "rażąca", "rażąco niska cena", "rażąco niskiej ceny", "rażąco niską cenę", "rażąco niska", "rażąco niskiej", "rażąco niskiego", "rażąco niskie", "kosztorys", "kosztorysu", "kalkulacja", "kalkulacji", "wycena", "wyceny"]}
]

Zapytanie: "niewłaściwy tryb postępowania"
keyword_groups: [
  {"concept": "tryb postępowania", "forms": ["tryb", "trybu", "trybem", "trybie", "tryby", "trybów", "tryb postępowania", "trybu postępowania", "trybie postępowania", "procedura", "procedury", "procedurze"]},
  {"concept": "niewłaściwy", "forms": ["niewłaściwy", "niewłaściwego", "niewłaściwym", "niewłaściwą", "nieprawidłowy", "nieprawidłowego", "nieprawidłowym", "wadliwy", "wadliwego", "błędny", "błędnego", "naruszenie", "naruszenia"]}
]

Zapytanie: "wykluczenie wykonawcy za fałszywe oświadczenie"
keyword_groups: [
  {"concept": "wykluczenie", "forms": ["wykluczenie", "wykluczenia", "wykluczeniem", "wykluczeniu", "wykluczyć", "przesłanki wykluczenia", "przesłanek wykluczenia", "podstawy wykluczenia"]},
  {"concept": "wykonawca", "forms": ["wykonawca", "wykonawcy", "wykonawcę", "wykonawców", "wykonawcą", "podmiot", "konsorcjum"]},
  {"concept": "fałszywe oświadczenie", "forms": ["fałszywe", "fałszywego", "fałszywym", "nieprawdziwe", "nieprawdziwych", "fałszywe oświadczenie", "fałszywego oświadczenia", "nieprawdziwe informacje", "wprowadzenie w błąd", "JEDZ", "oświadczenie", "oświadczenia"]}
]

Odpowiedz WYŁĄCZNIE prawidłowym JSON-em bez markdown, bez komentarzy:
{"keyword_groups": [...], "semantic_query": "...", "filters": {}}`;

export async function queryUnderstanding(userQuery: string, model?: string): Promise<{ result: QueryUnderstanding; cost: CostEntry }> {
  const response = await chatCompletion(
    [
      { role: "system", content: QUERY_UNDERSTANDING_PROMPT },
      { role: "user", content: userQuery },
    ],
    model || MODELS.QUERY_UNDERSTANDING,
    { temperature: 0.1, max_tokens: 1024 }
  );

  let parsed: QueryUnderstanding;
  try {
    const raw = JSON.parse(response.content);
    parsed = raw as QueryUnderstanding;

    // Ensure keyword_groups is properly structured
    if (Array.isArray(parsed.keyword_groups) && parsed.keyword_groups.length > 0) {
      // Validate each group has concept and forms
      parsed.keyword_groups = parsed.keyword_groups.filter(
        (g) => g && typeof g.concept === "string" && Array.isArray(g.forms) && g.forms.length > 0
      );
      // Safeguard: ensure each group has single-word forms for FTS recall
      if (parsed.keyword_groups.length > 0) {
        parsed.keyword_groups = ensureSingleWordForms(parsed.keyword_groups);
      }
    } else {
      // No valid groups — clear the field so buildTsQuery falls back to flat OR
      parsed.keyword_groups = undefined;
    }

    // Always derive flat keywords from groups (not from LLM output)
    parsed.keywords = parsed.keyword_groups
      ? parsed.keyword_groups.flatMap((g) => g.forms)
      : userQuery.split(/\s+/).filter((w) => w.length > 2);
    if (!parsed.semantic_query) {
      parsed.semantic_query = userQuery;
    }
    if (!parsed.filters) {
      parsed.filters = {};
    }
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
  const supabase = createAdminClient();

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

/**
 * Strip Polish diacritics from text. Used to generate diacritic-insensitive
 * FTS variants so "zamowien" matches "zamówień".
 */
// Polish stop words — excluded when extracting single words from phrases
const POLISH_STOP_WORDS = new Set([
  'i', 'w', 'z', 'na', 'do', 'o', 'za', 'od', 'po', 'nie', 'się', 'jest',
  'to', 'że', 'a', 'jak', 'ale', 'lub', 'ten', 'ta', 'te', 'tego', 'tej',
  'tym', 'tych', 'tę', 'przez', 'co', 'dla', 'przy', 'jako', 'ze', 'już',
  'być', 'też', 'które', 'który', 'która', 'których', 'którym', 'której',
  'może', 'oraz', 'ich', 'jej', 'jego', 'będzie', 'został', 'została',
  'zostało', 'nr',
]);

const MAX_PHRASE_WORDS = 3;
const MAX_SINGLE_WORD_FORMS = 10;

/**
 * Ensure each keyword group has single-word forms for FTS recall.
 * If a group only contains multi-word phrases, extract significant words
 * and add them as single-word forms. Drops phrases longer than MAX_PHRASE_WORDS.
 * Caps single-word forms to prevent overly broad queries that timeout.
 */
function ensureSingleWordForms(groups: KeywordGroup[]): KeywordGroup[] {
  return groups.map((group) => {
    let singleWordForms: string[] = [];
    const keptMultiWordForms: string[] = [];

    for (const form of group.forms) {
      const words = form.trim().split(/\s+/);
      if (words.length === 1) {
        singleWordForms.push(form);
      } else if (words.length <= MAX_PHRASE_WORDS) {
        keptMultiWordForms.push(form);
      }
      // Phrases > MAX_PHRASE_WORDS silently dropped (too restrictive for FTS adjacency)
    }

    // If no single-word forms, extract significant words from the CONCEPT NAME only.
    // Using concept name (not all phrases) keeps it conservative — extracting from
    // all phrases adds ultra-common words like "postępowania" that match nearly every
    // document and cause query timeouts during ts_rank computation.
    if (singleWordForms.length === 0) {
      for (const word of group.concept.split(/\s+/)) {
        if (word.length > 2 && !POLISH_STOP_WORDS.has(word.toLowerCase())) {
          singleWordForms.push(word);
        }
      }
    }

    // Cap single-word forms to prevent overly broad queries.
    // The LLM generates them in priority order (distinctive first, generic last),
    // so truncating keeps the most discriminating terms.
    if (singleWordForms.length > MAX_SINGLE_WORD_FORMS) {
      singleWordForms = singleWordForms.slice(0, MAX_SINGLE_WORD_FORMS);
    }

    return {
      ...group,
      forms: [...new Set([...singleWordForms, ...keptMultiWordForms])],
    };
  });
}

function stripPolishDiacritics(text: string): string {
  const map: Record<string, string> = {
    'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n',
    'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
    'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L', 'Ń': 'N',
    'Ó': 'O', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z',
  };
  return text.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) => map[c] || c);
}

/**
 * Expand a list of keyword forms with diacritic-stripped variants.
 * Only adds the stripped form if it differs from the original.
 */
function expandWithDiacriticVariants(forms: string[]): string[] {
  const expanded = new Set(forms);
  for (const form of forms) {
    const stripped = stripPolishDiacritics(form);
    if (stripped !== form) {
      expanded.add(stripped);
    }
  }
  return [...expanded];
}

/**
 * Convert a single keyword (possibly multi-word) into a tsquery fragment.
 * Single words → lexeme as-is. Multi-word → adjacency operator (<->).
 */
function keywordToTsFragment(kw: string): string | null {
  const words = kw.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const clean = words.map((w) => w.replace(/[&|!<>():*\\]/g, "")).filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0];
  return clean.join(" <-> ");
}

/**
 * Build a tsquery string from keyword groups (concept-grouped) or flat keywords.
 *
 * With groups: AND between concept groups, OR within each group's forms.
 *   e.g. (wycofanie | wycofania | cofnięcie) & (wadium | wadiem)
 *
 * Without groups (fallback): all keywords OR'd together (legacy behavior).
 */
function buildTsQuery(keywords: string[], keywordGroups?: KeywordGroup[]): string {
  if (keywordGroups && keywordGroups.length > 0) {
    const groupClauses = keywordGroups
      .map((group) => {
        const expandedForms = expandWithDiacriticVariants(group.forms);
        const fragments = expandedForms
          .map(keywordToTsFragment)
          .filter(Boolean) as string[];
        if (fragments.length === 0) return null;
        if (fragments.length === 1) return fragments[0];
        return `( ${fragments.join(" | ")} )`;
      })
      .filter(Boolean) as string[];

    if (groupClauses.length === 0) {
      // All groups empty — fall through to flat keywords
    } else if (groupClauses.length === 1) {
      return groupClauses[0];
    } else {
      return groupClauses.join(" & ");
    }
  }

  // Fallback: flat OR of all keywords (legacy behavior)
  const expandedKeywords = expandWithDiacriticVariants(keywords);
  return expandedKeywords
    .map(keywordToTsFragment)
    .filter(Boolean)
    .join(" | ");
}

/**
 * Build a relaxed (OR-only) tsquery from keyword groups, used when AND query
 * returns too few results.
 */
function buildTsQueryRelaxed(keywords: string[], keywordGroups?: KeywordGroup[]): string {
  const allForms = keywordGroups
    ? keywordGroups.flatMap((g) => g.forms)
    : keywords;
  return allForms
    .map(keywordToTsFragment)
    .filter(Boolean)
    .join(" | ");
}

interface FtsResult {
  results: ChunkResult[];
  timedOut: boolean;
}

async function ftsSearch(
  keywords: string[],
  filters: SearchFilters,
  limit: number = 50,
  keywordGroups?: KeywordGroup[],
): Promise<FtsResult> {
  const supabase = createAdminClient();
  const searchQuery = buildTsQuery(keywords, keywordGroups);

  const { data, error } = await supabase.rpc("search_chunks_fts", {
    search_query: searchQuery,
    match_count: limit,
    filter_type: filters.document_type || null,
    filter_decision: filters.decision_type || null,
    filter_date_from: filters.date_from || null,
    filter_date_to: filters.date_to || null,
  });

  // On timeout, degrade gracefully — vector search still provides results
  if (error) {
    if (error.message?.includes("statement timeout")) {
      console.warn(`FTS timeout for query: ${searchQuery.slice(0, 200)}...`);
      return { results: [], timedOut: true };
    }
    throw new Error(`FTS search error: ${error.message}`);
  }

  // Safety net: if AND-grouped query returned too few results, retry with relaxed OR
  if (keywordGroups && keywordGroups.length > 1 && (!data || data.length < 5)) {
    const relaxedQuery = buildTsQueryRelaxed(keywords, keywordGroups);
    if (relaxedQuery !== searchQuery) {
      const { data: relaxedData, error: relaxedError } = await supabase.rpc("search_chunks_fts", {
        search_query: relaxedQuery,
        match_count: limit,
        filter_type: filters.document_type || null,
        filter_decision: filters.decision_type || null,
        filter_date_from: filters.date_from || null,
        filter_date_to: filters.date_to || null,
      });
      if (!relaxedError && relaxedData && relaxedData.length > (data?.length || 0)) {
        return { results: mapFtsRows(relaxedData), timedOut: false };
      }
    }
  }

  return { results: mapFtsRows(data || []), timedOut: false };
}

function mapFtsRows(data: Record<string, unknown>[]): ChunkResult[] {
  return data.map((row) => ({
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
      const preamblePrefix = c.preamble ? `${c.preamble}\n` : '';
      const preview = preamblePrefix + c.chunk_text.slice(0, 1200);
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

    // Append remaining chunks (31+) with gradual decay instead of hard cliff
    const remaining = chunks.slice(30).map((c, i) => {
      const rrfNorm = maxRrf > 0 ? c.score / maxRrf : 0;
      // Estimate LLM score decaying from 0.3 (moderate-low relevance)
      const estimatedLlmNorm = Math.max(0.1, 0.3 - i * 0.005);
      return {
        ...c,
        score: 0.3 * rrfNorm + 0.7 * estimatedLlmNorm,
      };
    });
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

/**
 * Compute verdict-level relevance from its matching passages.
 * Best chunk score + diminishing bonus for additional matching chunks.
 */
function computeVerdictScore(passages: { score: number }[]): number {
  if (passages.length === 0) return 0;
  const sorted = passages.map((p) => p.score).sort((a, b) => b - a);
  const best = sorted[0];
  const bonus = sorted.slice(1).reduce((sum, s, i) => {
    return sum + s * (0.1 / (i + 1));
  }, 0);
  return best + bonus;
}

function groupByVerdict(chunks: ChunkResult[], maxVerdicts: number = 15): VerdictResult[] {
  const verdictMap = new Map<number, VerdictResult>();

  for (const chunk of chunks) {
    const existing = verdictMap.get(chunk.verdict_id);
    if (existing) {
      existing.matching_passages.push({
        chunk_text: chunk.chunk_text,
        section_label: chunk.section_label,
        chunk_position: chunk.chunk_position,
        score: chunk.score,
      });
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
            chunk_position: chunk.chunk_position,
            score: chunk.score,
          },
        ],
      });
    }
  }

  // Recompute verdict scores with multi-chunk bonus
  for (const v of verdictMap.values()) {
    v.relevance_score = computeVerdictScore(v.matching_passages);
  }

  return Array.from(verdictMap.values())
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, maxVerdicts);
}

// ============================================================
// Layer 3: Answer Generation
// ============================================================

const ANSWER_GENERATION_PROMPT = `ROLA: Jesteś ekspertem prawa zamówień publicznych analizującym orzecznictwo KIO.

ZADANIE: Na podstawie WYŁĄCZNIE dostarczonych fragmentów orzeczeń KIO, przygotuj WYCZERPUJĄCĄ analizę prawną odpowiadającą na pytanie użytkownika.

BEZWZGLĘDNY ZAKAZ: NIE stosuj żadnych elementów odgrywania roli, fikcyjnych ram narracyjnych ani konwencji korespondencji. Zakazane są: nagłówki typu "Notatka służbowa", "Memo", "Szanowny Partnerze", zwroty grzecznościowe, podpisy, daty, adresy, nagłówki "Do/Od". Zacznij BEZPOŚREDNIO od merytorycznej analizy — pierwsze zdanie musi dotyczyć treści prawnej.

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
    fts_timed_out: boolean;
    answer_prompt: { role: string; content: string }[] | null;
  };
}

export async function searchBase(
  userQuery: string,
  filters?: SearchFilters,
  onStatus?: (status: string) => void,
  queryModel?: string,
): Promise<SearchBaseResult> {
  const startTime = Date.now();
  const costs: CostEntry[] = [];
  let totalTokens = 0;

  // Layer 1: Query Understanding
  onStatus?.("query_understanding");
  const { result: understanding, cost: l1Cost } = await queryUnderstanding(userQuery, queryModel);
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
  onStatus?.("searching");
  const dbSearchStart = Date.now();
  const [vectorResults, ftsResult] = await Promise.all([
    vectorSearch(embedding, mergedFilters, 150),
    ftsSearch(understanding.keywords, mergedFilters, 150, understanding.keyword_groups),
  ]);
  const ftsResults = ftsResult.results;
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
  onStatus?.("reranking");
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
      fts_query: buildTsQuery(understanding.keywords, understanding.keyword_groups),
      fts_timed_out: ftsResult.timedOut,
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
