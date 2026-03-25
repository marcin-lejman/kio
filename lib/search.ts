import { createAdminClient } from "./supabase/admin";
import { chatCompletion, chatCompletionStream, embedText, estimateCost, MODELS, type LLMResponse } from "./openrouter";

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
  weight?: number;    // importance weight 1.0-3.0 (default 1.0)
  required?: boolean; // chunk must match this group to be included (default false)
}

export interface QueryUnderstanding {
  keywords: string[];
  keyword_groups?: KeywordGroup[];
  mandatory_terms?: string[];  // +keyword terms that MUST appear in results
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
// Verdict Envelope — enriched per-verdict context for AI overview
// ============================================================

const ENVELOPE_MAX_VERDICTS = 15;
const ENVELOPE_TOKEN_BUDGET = 40_000;
const ENVELOPE_MAX_MATCHED_PER_VERDICT = 3;

interface VerdictEnvelopeChunk {
  chunk_text: string;
  section_label: string;
  chunk_position: number;
  total_chunks: number;
  score: number;
}

export interface VerdictEnvelope {
  verdict_id: number;
  sygnatura: string;
  verdict_date: string;
  document_type_normalized: string;
  decision_type_normalized: string;
  sentencja: string | null;
  matched_chunks: VerdictEnvelopeChunk[];
  supplementary_fakty: string | null;
  supplementary_rozważania: string | null;
}

// ============================================================
// Layer 1: Query Understanding
// ============================================================

const QUERY_UNDERSTANDING_PROMPT = `Jesteś asystentem wyszukiwarki orzeczeń Krajowej Izby Odwoławczej (KIO) w zamówieniach publicznych.

Twoim zadaniem jest analiza zapytania użytkownika i wygenerowanie:
1. keyword_groups — lista GRUP pojęciowych. Każda grupa to jeden koncept z zapytania, z wariantami gramatycznymi i synonimy. Generuj 5-15 form na grupę. Każda grupa: {"concept": "nazwa_konceptu", "forms": ["forma1", "forma2", ...], "weight": 1.0-3.0, "required": true/false}.
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
- FLEKSJA: Indeks używa konfiguracji 'simple' BEZ stemmingu — każda forma fleksyjna to osobny token. Dlatego odmieniaj kluczowe rzeczowniki i przymiotniki przez WSZYSTKIE przypadki (M, D, C, B, N, Mc). Bez tego formy jak "wadiem" (narzędnik) czy "wykluczeniu" (miejscownik) nie zostaną znalezione.
- NIE dodawaj jako form jednowyrazowych OGÓLNYCH terminów prawnych, które występują w niemal każdym orzeczeniu KIO (np. "postępowanie", "zamawiający", "zamówienie", "oferta", "ustawa"). Takie terminy pasują do wszystkich dokumentów i powodują timeout wyszukiwania. Używaj ich WYŁĄCZNIE jako część fraz wielowyrazowych. Np. dla konceptu "tryb postępowania": generuj "tryb", "trybu", "trybem" ale NIE "postępowanie", "postępowania" osobno — zachowaj je w frazach "tryb postępowania".
- NIE dodawaj OGÓLNYCH rzeczowników, które pasują do wielu branż i tematów i nie wnoszą informacji wyszukiwawczej. Przykłady: "produkt", "produktów", "usługa", "usługi", "dostawa", "dostawy", "dokument", "dokumenty", "element", "elementy", "materiał", "materiały", "przedmiot", "przedmiotu", "zakres", "zakresu", "sposób", "warunek", "warunki", "wymaganie", "wymagania", "środek", "środki". Takie słowa generują szum — pasują do setek orzeczeń niezwiązanych z zapytaniem. Używaj ich WYŁĄCZNIE w frazach wielowyrazowych (np. "dostawa wyrobów medycznych", nie "dostawa" osobno).

ZASADY WAGI (weight) I WYMAGALNOŚCI (required):
- Każda grupa ma pole "weight" (float 1.0-3.0) — jak centralna jest grupa dla intencji zapytania.
- Rdzeń zapytania (główny koncept prawny): weight 2.5-3.0, required: true.
- Istotne koncepty wspierające (sedno problemu, okoliczności kluczowe): weight 1.5-2.5.
- Kontekst, branża, uzupełnienia: weight 1.0-1.5.
- Maksymalnie JEDNA grupa może mieć "required": true — to rdzeń zapytania, bez którego wynik jest irrelewantny.
- Jeśli zapytanie jest ogólne i nie ma wyraźnego rdzenia, żadna grupa nie musi być required (wszystkie required: false).

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
  {"concept": "wycofanie", "weight": 2.5, "required": true, "forms": ["wycofanie", "wycofania", "wycofaniu", "wycofać", "wycofał", "cofnięcie", "cofnięcia", "zwrot", "zwrotu", "zwrócenie"]},
  {"concept": "wadium", "weight": 2.5, "required": false, "forms": ["wadium", "wadiem", "wadialne", "zabezpieczenie wadialne", "zabezpieczenia wadialnego"]}
]

Zapytanie: "rażąco niska cena"
keyword_groups: [
  {"concept": "rażąco niska cena", "weight": 3.0, "required": true, "forms": ["rażąco", "rażąca", "rażąco niska cena", "rażąco niskiej ceny", "rażąco niską cenę", "rażąco niska", "rażąco niskiej", "rażąco niskiego", "rażąco niskie", "kosztorys", "kosztorysu", "kalkulacja", "kalkulacji", "wycena", "wyceny"]}
]

Zapytanie: "niewłaściwy tryb postępowania"
keyword_groups: [
  {"concept": "tryb postępowania", "weight": 2.5, "required": true, "forms": ["tryb", "trybu", "trybem", "trybie", "tryby", "trybów", "tryb postępowania", "trybu postępowania", "trybie postępowania", "procedura", "procedury", "procedurze"]},
  {"concept": "niewłaściwy", "weight": 2.0, "required": false, "forms": ["niewłaściwy", "niewłaściwego", "niewłaściwym", "niewłaściwą", "nieprawidłowy", "nieprawidłowego", "nieprawidłowym", "wadliwy", "wadliwego", "błędny", "błędnego", "naruszenie", "naruszenia"]}
]

Zapytanie: "wykluczenie wykonawcy za fałszywe oświadczenie"
keyword_groups: [
  {"concept": "wykluczenie", "weight": 3.0, "required": true, "forms": ["wykluczenie", "wykluczenia", "wykluczeniem", "wykluczeniu", "wykluczyć", "przesłanki wykluczenia", "przesłanek wykluczenia", "podstawy wykluczenia"]},
  {"concept": "wykonawca", "weight": 1.0, "required": false, "forms": ["wykonawca", "wykonawcy", "wykonawcę", "wykonawców", "wykonawcą", "podmiot", "konsorcjum"]},
  {"concept": "fałszywe oświadczenie", "weight": 2.5, "required": false, "forms": ["fałszywe", "fałszywego", "fałszywym", "nieprawdziwe", "nieprawdziwych", "fałszywe oświadczenie", "fałszywego oświadczenia", "nieprawdziwe informacje", "wprowadzenie w błąd", "JEDZ", "oświadczenie", "oświadczenia"]}
]

Odpowiedz WYŁĄCZNIE prawidłowym JSON-em bez markdown, bez komentarzy:
{"keyword_groups": [{"concept": "...", "forms": [...], "weight": 2.5, "required": true}, ...], "semantic_query": "...", "filters": {}}`;

/**
 * Extract +mandatory terms from the query. Supports +word and +"multi word".
 * Returns the cleaned query (without + terms) and the extracted terms.
 */
export function extractMandatoryTerms(query: string): { cleanQuery: string; mandatoryTerms: string[] } {
  const terms: string[] = [];
  const cleanQuery = query
    .replace(/\+("([^"]+)"|(\S+))/g, (_, _full, quoted, unquoted) => {
      const term = (quoted || unquoted).trim();
      if (term) terms.push(term);
      return "";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { cleanQuery, mandatoryTerms: terms };
}

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
    const cleaned = response.content.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    const raw = JSON.parse(cleaned);
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
        // Validate and set defaults for weight/required
        for (const group of parsed.keyword_groups) {
          if (typeof group.weight !== "number" || group.weight < 0) {
            group.weight = 1.0;
          }
          if (typeof group.required !== "boolean") {
            group.required = false;
          }
        }
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
  } catch (err) {
    // Fallback: use the query as-is, filtering out stop words and common legal terms
    // that match nearly every document and cause FTS timeouts
    console.warn("Query understanding JSON parse failed, using fallback:", err);
    const FALLBACK_STOP = new Set([
      ...POLISH_STOP_WORDS,
      'kio', 'orzeczenia', 'orzeczenie', 'dotyczące', 'dotyczace', 'przetarg',
      'przetargu', 'przetargach', 'przetargi', 'zamówienie', 'zamówienia',
      'zamowienie', 'zamowienia', 'postępowanie', 'postępowania', 'postepowanie',
      'oferta', 'oferty', 'ofert', 'zamawiający', 'zamawiajacy', 'wykonawca',
      'wykonawcy', 'ustawa', 'ustawy', 'przepis', 'przepisy', 'zbyt',
    ]);
    parsed = {
      keywords: userQuery.split(/\s+/)
        .map(w => w.replace(/[–—,.:;!?()]/g, ''))
        .filter(w => w.length > 2 && !FALLBACK_STOP.has(w.toLowerCase())),
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
 * Build an OR tsquery for a single keyword group's forms (with diacritic expansion).
 */
function buildGroupTsQuery(group: KeywordGroup): string {
  const expandedForms = expandWithDiacriticVariants(group.forms);
  const fragments = expandedForms
    .map(keywordToTsFragment)
    .filter(Boolean) as string[];
  return fragments.join(" | ");
}

/**
 * Build a debug-friendly summary of the FTS query strategy.
 */
function buildFtsDebugString(keywords: string[], keywordGroups?: KeywordGroup[]): string {
  if (keywordGroups && keywordGroups.length > 0) {
    return keywordGroups.map(g =>
      `[${g.concept} w=${(g.weight ?? 1.0).toFixed(1)}${g.required ? " REQ" : ""}] ${buildGroupTsQuery(g)}`
    ).join("\n");
  }
  return expandWithDiacriticVariants(keywords)
    .map(keywordToTsFragment)
    .filter(Boolean)
    .join(" | ");
}

interface FtsResult {
  results: ChunkResult[];
  timedOut: boolean;
}

/**
 * Build a tsquery AND clause for mandatory +terms.
 * Each term is expanded with diacritic variants and converted to a tsquery fragment.
 */
function buildMandatoryClause(terms: string[]): string {
  return terms
    .map(term => {
      const expanded = expandWithDiacriticVariants([term]);
      const fragments = expanded.map(keywordToTsFragment).filter(Boolean) as string[];
      if (fragments.length === 0) return null;
      if (fragments.length === 1) return fragments[0];
      return `( ${fragments.join(" | ")} )`;
    })
    .filter(Boolean)
    .join(" & ");
}

/**
 * Split text into a set of unique words for word-boundary matching.
 * Uses Unicode-aware splitting to handle Polish characters (ą, ć, ę, etc.).
 */
function textToWordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

/**
 * Check if a chunk's text contains any form from a keyword group.
 * Uses whole-word matching (not substring) to avoid false positives
 * like "lek" matching "elektryczny".
 * For multi-word forms, checks if ALL words appear in the text.
 * Pass pre-computed textWords for performance in hot loops.
 */
function chunkMatchesGroup(text: string, group: KeywordGroup, textWords?: Set<string>): boolean {
  const words = textWords ?? textToWordSet(text);
  return group.forms.some(form => {
    const formWords = form.toLowerCase().split(/\s+/);
    return formWords.every(w => words.has(w));
  });
}

/**
 * Multi-group weighted FTS: unranked query + client-side group scoring.
 *
 * Uses ftsQueryUnranked (no ts_rank, no ORDER BY) so LIMIT is effective
 * regardless of how broad the query terms are.
 *
 * Query strategy: OR all forms from all groups. The unranked approach
 * makes this safe — no ts_rank bottleneck even on huge match sets.
 * Client-side scoring by group coverage is the primary ranking signal.
 *
 * Fallback: if OR-all times out (unlikely without ts_rank), return empty.
 */
async function ftsSearchWeighted(
  groups: KeywordGroup[],
  filters: SearchFilters,
  limit: number,
  mandatoryTerms?: string[],
): Promise<FtsResult> {
  const queryLimit = Math.min(limit * 3, 1000);

  // Build combined query: OR all forms from all groups
  const combinedQuery = groups.map(g => buildGroupTsQuery(g)).join(" | ");
  if (!combinedQuery) return { results: [], timedOut: true };

  const { results, timedOut } = await ftsQueryUnranked(
    combinedQuery, filters, queryLimit, mandatoryTerms
  );

  if (timedOut || results.length === 0) {
    return { results: [], timedOut };
  }

  // Score by group coverage: Σ weight_i for each matched group
  for (const chunk of results) {
    const textWords = textToWordSet(chunk.chunk_text);
    let score = 0;
    for (const group of groups) {
      if (chunkMatchesGroup(chunk.chunk_text, group, textWords)) {
        score += group.weight ?? 1.0;
      }
    }
    chunk.score = score;
  }

  results.sort((a, b) => b.score - a.score);
  return { results: results.slice(0, limit), timedOut: false };
}

async function ftsSearch(
  keywords: string[],
  filters: SearchFilters,
  limit: number = 50,
  keywordGroups?: KeywordGroup[],
  mandatoryTerms?: string[],
): Promise<FtsResult> {
  // Multi-group: weighted per-group approach
  if (keywordGroups && keywordGroups.length > 1) {
    return ftsSearchWeighted(keywordGroups, filters, limit, mandatoryTerms);
  }

  // Single group: prefer multi-word phrases for selectivity
  if (keywordGroups && keywordGroups.length === 1) {
    return ftsSearchSingleGroup(keywordGroups[0], filters, limit, mandatoryTerms);
  }

  // No groups: flat OR of all keywords
  const searchQuery = expandWithDiacriticVariants(keywords)
    .map(keywordToTsFragment)
    .filter(Boolean)
    .join(" | ");

  if (!searchQuery) return { results: [], timedOut: false };

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("search_chunks_fts", {
    search_query: searchQuery,
    match_count: limit,
    filter_type: filters.document_type || null,
    filter_decision: filters.decision_type || null,
    filter_date_from: filters.date_from || null,
    filter_date_to: filters.date_to || null,
  });

  if (error) {
    if (error.message?.includes("statement timeout")) {
      console.warn(`FTS timeout for query: ${searchQuery.slice(0, 200)}...`);
      return { results: [], timedOut: true };
    }
    throw new Error(`FTS search error: ${error.message}`);
  }

  return { results: mapFtsRows(data || []), timedOut: false };
}

/**
 * Unranked FTS query using Supabase .textSearch() directly.
 * No ts_rank computation, no ORDER BY — just GIN index scan + LIMIT.
 * This makes LIMIT effective: PostgreSQL stops after finding N matches
 * instead of scoring all matching rows first.
 *
 * Returns ChunkResult[] with score=0 — caller must assign scores.
 */
async function ftsQueryUnranked(
  query: string,
  filters: SearchFilters,
  limit: number,
  mandatoryTerms?: string[],
): Promise<{ results: ChunkResult[]; timedOut: boolean }> {
  // AND mandatory +terms into the query
  let finalQuery = query;
  if (mandatoryTerms && mandatoryTerms.length > 0) {
    const mandatoryClause = buildMandatoryClause(mandatoryTerms);
    if (mandatoryClause) {
      finalQuery = `( ${query} ) & ${mandatoryClause}`;
    }
  }

  const supabase = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let builder: any = supabase
    .from("chunks")
    .select(`
      id, verdict_id, section_label, chunk_position, total_chunks,
      preamble, chunk_text,
      verdicts!inner(
        sygnatura, verdict_date, document_type, document_type_normalized,
        decision_type, decision_type_normalized, chunking_tier
      )
    `)
    .textSearch("fts_vector", finalQuery, { config: "simple" })
    .limit(limit);

  if (filters.document_type) {
    builder = builder.eq("verdicts.document_type_normalized", filters.document_type);
  }
  if (filters.decision_type) {
    builder = builder.eq("verdicts.decision_type_normalized", filters.decision_type);
  }
  if (filters.date_from) {
    builder = builder.gte("verdicts.verdict_date", filters.date_from);
  }
  if (filters.date_to) {
    builder = builder.lte("verdicts.verdict_date", filters.date_to);
  }

  const { data, error } = await builder;

  if (error) {
    if (error.message?.includes("statement timeout")) {
      return { results: [], timedOut: true };
    }
    throw new Error(`FTS unranked query error: ${error.message}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: ChunkResult[] = (data || []).map((row: any) => {
    const v = row.verdicts;
    return {
      chunk_id: row.id as number,
      verdict_id: row.verdict_id as number,
      section_label: row.section_label as string,
      chunk_position: row.chunk_position as number,
      total_chunks: row.total_chunks as number,
      preamble: row.preamble as string,
      chunk_text: row.chunk_text as string,
      score: 0,
      source: "fts" as const,
      sygnatura: v.sygnatura as string,
      verdict_date: v.verdict_date as string,
      document_type: v.document_type as string,
      document_type_normalized: v.document_type_normalized as string,
      decision_type: v.decision_type as string,
      decision_type_normalized: v.decision_type_normalized as string,
      chunking_tier: v.chunking_tier as string,
    };
  });

  return { results, timedOut: false };
}

/**
 * Single-group FTS: unranked query with all forms, score client-side
 * by counting how many forms from the group match the chunk text.
 */
async function ftsSearchSingleGroup(
  group: KeywordGroup,
  filters: SearchFilters,
  limit: number,
  mandatoryTerms?: string[],
): Promise<FtsResult> {
  const fullQuery = buildGroupTsQuery(group);
  if (!fullQuery) return { results: [], timedOut: false };

  const { results, timedOut } = await ftsQueryUnranked(
    fullQuery, filters, Math.min(limit * 3, 1000), mandatoryTerms
  );

  if (timedOut || results.length === 0) {
    return { results: [], timedOut };
  }

  // Score by counting matching forms — chunks with more matches rank higher
  for (const chunk of results) {
    const textWords = textToWordSet(chunk.chunk_text);
    let matchCount = 0;
    for (const form of group.forms) {
      const formWords = form.toLowerCase().split(/\s+/);
      if (formWords.every(w => textWords.has(w))) {
        matchCount++;
      }
    }
    chunk.score = matchCount;
  }

  results.sort((a, b) => b.score - a.score);
  return { results: results.slice(0, limit), timedOut: false };
}

function mapFtsRow(row: Record<string, unknown>): ChunkResult {
  return {
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
  };
}

function mapFtsRows(data: Record<string, unknown>[]): ChunkResult[] {
  return data.map(mapFtsRow);
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

/**
 * Compute group coverage for a verdict: what fraction of keyword groups
 * are represented across all of the verdict's matching chunks.
 * Returns a multiplier (1.0 = no boost, up to 2.0 for full coverage).
 */
function computeGroupCoverageBoost(
  passages: { chunk_text: string }[],
  keywordGroups: KeywordGroup[],
): number {
  if (keywordGroups.length === 0) return 1.0;

  // Combine all passage text, build word set once
  const combinedText = passages.map(p => p.chunk_text).join(" ");
  const textWords = textToWordSet(combinedText);

  let groupsMatched = 0;
  for (const group of keywordGroups) {
    if (chunkMatchesGroup(combinedText, group, textWords)) {
      groupsMatched++;
    }
  }

  // Linear boost: 1.0 (no groups matched) to 2.0 (all groups matched)
  return 1.0 + (groupsMatched / keywordGroups.length);
}

function groupByVerdict(
  chunks: ChunkResult[],
  maxVerdicts: number = 15,
  keywordGroups?: KeywordGroup[],
): VerdictResult[] {
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

  // Recompute verdict scores with multi-chunk bonus + group coverage
  for (const v of verdictMap.values()) {
    const baseScore = computeVerdictScore(v.matching_passages);
    const coverageBoost = keywordGroups && keywordGroups.length > 1
      ? computeGroupCoverageBoost(v.matching_passages, keywordGroups)
      : 1.0;
    v.relevance_score = baseScore * coverageBoost;
  }

  return Array.from(verdictMap.values())
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, maxVerdicts);
}

// ============================================================
// Verdict Envelope Enrichment
// ============================================================

/** Approximate token count for Polish text (matches ingest.py heuristic). */
function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.5);
}

const SUPPLEMENTARY_LABELS = ["sentencja", "uzasadnienie_fakty", "uzasadnienie_rozważania"] as const;

/**
 * Build enriched per-verdict context for the AI overview.
 * For each top verdict, fetches sentencja + fakty + rozważania sections
 * that were not already in the search results, giving the LLM a
 * coherent per-case view instead of disconnected chunk fragments.
 */
async function fetchVerdictEnvelopes(
  rerankedChunks: ChunkResult[],
  maxVerdicts: number = ENVELOPE_MAX_VERDICTS,
  tokenBudget: number = ENVELOPE_TOKEN_BUDGET,
): Promise<VerdictEnvelope[]> {
  // 1. Group chunks by verdict (reuse existing logic), take top N
  const grouped = groupByVerdict(rerankedChunks, maxVerdicts);

  if (grouped.length === 0) return [];

  const verdictIds = grouped.map((v) => v.verdict_id);

  // 2. Build a map of matched chunks per verdict from reranked results
  const matchedByVerdict = new Map<number, ChunkResult[]>();
  for (const chunk of rerankedChunks) {
    if (!verdictIds.includes(chunk.verdict_id)) continue;
    const existing = matchedByVerdict.get(chunk.verdict_id) || [];
    existing.push(chunk);
    matchedByVerdict.set(chunk.verdict_id, existing);
  }

  // 3. Single DB query for supplementary sections
  const supabase = createAdminClient();
  const { data: extraChunks, error } = await supabase
    .from("chunks")
    .select("verdict_id, section_label, chunk_position, chunk_text, total_chunks")
    .in("verdict_id", verdictIds)
    .in("section_label", SUPPLEMENTARY_LABELS as unknown as string[])
    .order("verdict_id")
    .order("chunk_position");

  if (error) {
    console.error("Failed to fetch supplementary chunks:", error);
  }

  // Index supplementary chunks by verdict_id
  const extraByVerdict = new Map<number, typeof extraChunks>();
  for (const row of extraChunks || []) {
    const arr = extraByVerdict.get(row.verdict_id) || [];
    arr.push(row);
    extraByVerdict.set(row.verdict_id, arr);
  }

  // 4. Build envelopes with token budget enforcement
  const envelopes: VerdictEnvelope[] = [];
  let totalTokens = 0;

  for (const verdict of grouped) {
    const matched = (matchedByVerdict.get(verdict.verdict_id) || [])
      .sort((a, b) => b.score - a.score)
      .slice(0, ENVELOPE_MAX_MATCHED_PER_VERDICT);

    const matchedLabels = new Set(matched.map((c) => c.section_label));
    const extra = extraByVerdict.get(verdict.verdict_id) || [];

    // Find sentencja (first chunk only)
    const sentencjaChunk = extra.find((c) => c.section_label === "sentencja");
    const sentencja = sentencjaChunk && !matchedLabels.has("sentencja")
      ? sentencjaChunk.chunk_text
      : null;

    // Find first uzasadnienie_fakty (only if not already matched)
    const faktyChunk = extra.find((c) => c.section_label === "uzasadnienie_fakty");
    const supplementaryFakty = faktyChunk && !matchedLabels.has("uzasadnienie_fakty")
      ? faktyChunk.chunk_text
      : null;

    // Find first uzasadnienie_rozważania (only if not already matched)
    const rozważaniaChunk = extra.find((c) => c.section_label === "uzasadnienie_rozważania");
    const supplementaryRozważania = rozważaniaChunk && !matchedLabels.has("uzasadnienie_rozważania")
      ? rozważaniaChunk.chunk_text
      : null;

    // Estimate tokens for this envelope
    let envelopeTokens = 0;
    for (const c of matched) envelopeTokens += estimateTokens(c.chunk_text);
    if (sentencja) envelopeTokens += estimateTokens(sentencja);
    if (supplementaryFakty) envelopeTokens += estimateTokens(supplementaryFakty);
    if (supplementaryRozważania) envelopeTokens += estimateTokens(supplementaryRozważania);

    // Token budget check — stop adding verdicts if exceeded
    if (totalTokens + envelopeTokens > tokenBudget && envelopes.length > 0) break;
    totalTokens += envelopeTokens;

    envelopes.push({
      verdict_id: verdict.verdict_id,
      sygnatura: verdict.sygnatura,
      verdict_date: verdict.verdict_date,
      document_type_normalized: verdict.document_type_normalized,
      decision_type_normalized: verdict.decision_type_normalized,
      sentencja,
      matched_chunks: matched.map((c) => ({
        chunk_text: c.chunk_text,
        section_label: c.section_label,
        chunk_position: c.chunk_position,
        total_chunks: c.total_chunks,
        score: c.score,
      })),
      supplementary_fakty: supplementaryFakty,
      supplementary_rozważania: supplementaryRozważania,
    });
  }

  return envelopes;
}

// ============================================================
// Layer 3: Answer Generation
// ============================================================

const ANSWER_GENERATION_PROMPT = `ROLA: Jesteś ekspertem prawa zamówień publicznych analizującym orzecznictwo KIO.

ZADANIE: Na podstawie WYŁĄCZNIE dostarczonych orzeczeń KIO, przygotuj WYCZERPUJĄCĄ analizę prawną odpowiadającą na pytanie użytkownika.

BEZWZGLĘDNY ZAKAZ: NIE stosuj żadnych elementów odgrywania roli, fikcyjnych ram narracyjnych ani konwencji korespondencji. Zakazane są: nagłówki typu "Notatka służbowa", "Memo", "Szanowny Partnerze", zwroty grzecznościowe, podpisy, daty, adresy, nagłówki "Do/Od". Zacznij BEZPOŚREDNIO od merytorycznej analizy — pierwsze zdanie musi dotyczyć treści prawnej.

FORMAT MATERIAŁU ŹRÓDŁOWEGO:
Materiał jest pogrupowany PO ORZECZENIACH. Każde orzeczenie może zawierać:
- [SENTENCJA] — rozstrzygnięcie Izby (uwzględnienie/oddalenie/umorzenie). Wykorzystaj do ustalenia wyniku sprawy.
- [TRAFIONY FRAGMENT] — fragment, który algorytm wyszukiwania uznał za najbardziej powiązany z pytaniem. To punkt wyjścia do analizy.
- [STAN FAKTYCZNY] — tło faktyczne sprawy. Wykorzystaj do zrozumienia kontekstu, przedmiotu zamówienia i okoliczności.
- [ROZWAŻANIA] — uzasadnienie prawne Izby. Wykorzystaj do zrozumienia argumentacji i tez prawnych.

OCENA TRAFNOŚCI ORZECZEŃ:
1. Dla każdego orzeczenia oceń jego trafność w odniesieniu do pytania użytkownika. Jeśli orzeczenie dotyczy zupełnie innego zagadnienia prawnego niż pytanie (np. pytanie o wadium, a orzeczenie o warunkach udziału), POMIŃ je całkowicie — nie wspominaj o nim w odpowiedzi.
2. Przeanalizuj całościowo każde trafne orzeczenie, wykorzystując sentencję, trafione fragmenty, stan faktyczny i rozważania do pełnego zrozumienia stanowiska Izby.

ZASADY PRACY Z MATERIAŁEM ŹRÓDŁOWYM:
3. Opieraj się WYŁĄCZNIE na dostarczonych fragmentach. Nie uzupełniaj treści wiedzą ogólną, doktryną ani własnymi wnioskami wykraczającymi poza tekst fragmentów.
4. Jeśli fragment jest niejasny lub niepełny — zaznacz to wprost zamiast domyślać się intencji Izby.
5. Jeśli fragmenty nie pozwalają na pełną odpowiedź, napisz co z nich wynika i wyraźnie wskaż luki (np. "Dostępne fragmenty nie odnoszą się do kwestii X").
6. NIE łącz tez z różnych orzeczeń w sposób sugerujący, że Izba wypowiedziała się w danej sprawie kompleksowo, jeśli każde orzeczenie dotyczyło innego stanu faktycznego.
7. WYKORZYSTAJ MAKSYMALNIE wszystkie orzeczenia, które są merytorycznie powiązane z zapytaniem. Pomiń jedynie orzeczenia ewidentnie nietrafione (dotyczące zupełnie innego zagadnienia prawnego).

CYTOWANIE I SYGNATURY:
8. Każde twierdzenie o stanowisku Izby MUSI zawierać odniesienie do konkretnego orzeczenia w formacie [KIO XXXX/XX].
9. BEZWZGLĘDNY ZAKAZ cytowania sygnatur spoza sekcji „BIAŁA LISTA SYGNATUR" w wiadomości użytkownika. To jest zamknięta, wyczerpująca lista — żadne inne sygnatury NIE ISTNIEJĄ. Nie wymyślaj, nie rekonstruuj z pamięci, nie zgaduj numerów. Jeśli nie ma sygnatury na białej liście, NIE MOŻESZ się do niej odwołać. Naruszenie tej zasady jest KRYTYCZNYM BŁĘDEM.
10. Przepisuj sygnatury z białej listy DOKŁADNIE — nie zmieniaj, nie łącz, nie skracaj numerów.
11. Cytaty dosłowne z fragmentów oznaczaj cudzysłowami „...". Cytuj dosłownie TYLKO gdy precyzyjne sformułowanie Izby ma znaczenie dla argumentacji. W pozostałych przypadkach parafrazuj.
12. Każdy cytat dosłowny musi być możliwy do zweryfikowania w dostarczonym fragmencie — nie rekonstruuj cytatów z pamięci.

STRUKTURA ODPOWIEDZI:
13. Zacznij od 1-2 zdań podsumowujących główny wniosek wynikający z analizowanych orzeczeń.
14. Następnie przedstaw stanowiska z poszczególnych orzeczeń. Dla każdego trafnego orzeczenia wskaż: rozstrzygnięcie (z sentencji), kontekst faktyczny i kluczową tezę prawną. NIE przepisuj obszernych fragmentów — streszczaj i cytuj dosłownie tylko kluczowe sformułowania Izby.
15. Jeśli orzeczenia prezentują rozbieżne stanowiska, wyraźnie to zaznacz.
16. Zakończ krótką oceną przydatności dostępnego materiału dla pytania użytkownika (np. "Powyższe orzeczenia dotyczą bezpośrednio problematyki X" lub "Fragmenty dotyczą pokrewnych zagadnień, ale nie odpowiadają wprost na pytanie o Y").
17. ZWIĘZŁOŚĆ: mimo bogatszego kontekstu per orzeczenie, odpowiedź powinna być skoncentrowana i czytelna. Jeśli kilka orzeczeń prezentuje tę samą tezę — grupuj je tematycznie zamiast opisywać każde z osobna.

STYL:
18. Pisz po polsku, językiem prawniczym ale komunikatywnym — jak w notatce wewnętrznej kancelarii, nie jak w podręczniku.
19. Unikaj ogólników typu "Izba wielokrotnie podkreślała" jeśli masz tylko 1-2 orzeczenia na dany temat. Precyzyjnie oddawaj skalę materiału.`;

/**
 * Build the list of individual citable sygnaturas from envelopes.
 * Splits pipe-separated sygnaturas into individual parts.
 */
function normalizeSygnatura(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/").trim();
}

function buildCitableList(envelopes: VerdictEnvelope[]): string[] {
  const set = new Set<string>();
  for (const env of envelopes) {
    if (env.sygnatura.includes("|")) {
      for (const part of env.sygnatura.split("|")) {
        const normalized = normalizeSygnatura(part);
        if (normalized) set.add(normalized);
      }
    } else {
      set.add(normalizeSygnatura(env.sygnatura));
    }
  }
  return [...set];
}

function buildAnswerContext(envelopes: VerdictEnvelope[]): string {
  return envelopes
    .map((env, i) => {
      const sygLabel = env.sygnatura.includes("|")
        ? env.sygnatura.split("|").map((s) => s.trim()).join(", ")
        : env.sygnatura;

      const parts: string[] = [];
      parts.push(`=== Orzeczenie ${i + 1}: ${sygLabel} (${env.document_type_normalized}, ${env.verdict_date}, ${env.decision_type_normalized}) ===`);

      // Sentencja (supplementary — not from search results)
      if (env.sentencja) {
        parts.push(`[SENTENCJA]\n${env.sentencja}`);
      }

      // Matched chunks from search results
      for (const mc of env.matched_chunks) {
        parts.push(`[TRAFIONY FRAGMENT — ${mc.section_label}, pozycja ${mc.chunk_position}/${mc.total_chunks}]\n${mc.chunk_text}`);
      }

      // Supplementary factual background
      if (env.supplementary_fakty) {
        parts.push(`[STAN FAKTYCZNY]\n${env.supplementary_fakty}`);
      }

      // Supplementary legal reasoning
      if (env.supplementary_rozważania) {
        parts.push(`[ROZWAŻANIA]\n${env.supplementary_rozważania}`);
      }

      return parts.join("\n\n");
    })
    .join("\n\n");
}

export function buildAnswerMessages(userQuery: string, semanticQuery: string, envelopes: VerdictEnvelope[]) {
  const context = buildAnswerContext(envelopes);
  const citableList = buildCitableList(envelopes);
  const count = envelopes.length;

  // For larger sets, instruct the model to be more comprehensive
  const scopeInstruction = count > 15
    ? `\n\nWAŻNE: Otrzymujesz ${count} orzeczeń — to rozszerzona analiza. Użytkownik CELOWO poprosił o więcej materiału. Przeanalizuj KAŻDE orzeczenie i uwzględnij je w odpowiedzi (chyba że jest ewidentnie nietrafne). Nie streszczaj nadmiernie — daj pełniejszy obraz orzecznictwa. Odpowiedź powinna być proporcjonalnie dłuższa niż przy 15 orzeczeniach.`
    : "";

  return [
    { role: "system" as const, content: ANSWER_GENERATION_PROMPT + scopeInstruction },
    {
      role: "user" as const,
      content: `Pytanie użytkownika: ${userQuery}\n\nZapytanie semantyczne: ${semanticQuery}\n\nLiczba dostarczonych orzeczeń: ${count}\n\nOrzeczenia KIO:\n\n${context}\n\n========================================\nBIAŁA LISTA SYGNATUR — JEDYNE sygnatury, które możesz cytować:\n${citableList.map(s => `• ${s}`).join("\n")}\n========================================\nUWAGA: Jakiekolwiek odwołanie do sygnatury SPOZA powyższej listy jest niedopuszczalne.`,
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
  envelopes: VerdictEnvelope[];
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
    simple_mode?: {
      original_query: string;
      parsed_terms: string[];
      expansions: Record<string, string[]>;
      tsquery: string;
    };
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

  // Extract +mandatory terms before LLM sees the query
  const { cleanQuery, mandatoryTerms } = extractMandatoryTerms(userQuery);

  // Layer 1: Query Understanding (receives query without + syntax)
  onStatus?.("query_understanding");
  const { result: understanding, cost: l1Cost } = await queryUnderstanding(
    cleanQuery || userQuery, queryModel
  );
  understanding.mandatory_terms = mandatoryTerms.length > 0 ? mandatoryTerms : undefined;
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
    ftsSearch(understanding.keywords, mergedFilters, 150, understanding.keyword_groups, understanding.mandatory_terms),
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
  let fusedChunks = reciprocalRankFusion(vectorResults, ftsResults);

  // Post-filter: mandatory +terms must appear in chunk text (catches vector results too)
  if (understanding.mandatory_terms && understanding.mandatory_terms.length > 0) {
    const requiredTerms = understanding.mandatory_terms;
    fusedChunks = fusedChunks.filter(chunk => {
      const textWords = textToWordSet(chunk.chunk_text);
      return requiredTerms.every(term => {
        const termWords = term.toLowerCase().split(/\s+/);
        return termWords.every(w => textWords.has(w));
      });
    });
  }

  // Layer 2.5: LLM Reranking
  onStatus?.("reranking");
  const { reranked: rerankedChunks, cost: rerankCost, scores: rerankScores } =
    await rerankChunks(userQuery, fusedChunks);
  costs.push(rerankCost);
  totalTokens += rerankCost.input_tokens + rerankCost.output_tokens;

  const verdicts = groupByVerdict(rerankedChunks, 100, understanding.keyword_groups);

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

  // Build enriched verdict envelopes for AI overview
  const envelopes = rerankedChunks.length > 0
    ? await fetchVerdictEnvelopes(rerankedChunks)
    : [];

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
    envelopes,
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
      fts_query: buildFtsDebugString(understanding.keywords, understanding.keyword_groups),
      fts_timed_out: ftsResult.timedOut,
      answer_prompt: envelopes.length > 0 ? buildAnswerMessages(userQuery, understanding.semantic_query, envelopes) : null,
    },
  };
}

// ============================================================
// Simple Search Mode — Boolean FTS with LLM pseudo-stemming
// ============================================================

const SIMPLE_STEMMING_PROMPT = `Jesteś narzędziem do odmiany polskich słów. Dostajesz listę terminów i dla każdego generujesz odmiany fleksyjne (przypadki: M, D, C, B, N, Mc, W + formy czasownikowe jeśli dotyczy).

ZASADY:
- Generuj 5-10 form na termin.
- Dla rzeczowników: wszystkie przypadki liczby pojedynczej + mianownik liczby mnogiej.
- Dla przymiotników: rodzaj męski, żeński, nijaki + formy przypadkowe.
- Dla czasowników: bezokolicznik + 3 os. l.poj. + imiesłów bierny + rzeczownik odczasownikowy.
- Dla fraz wielowyrazowych (w cudzysłowie): odmień CAŁĄ frazę zachowując związek rządu. Np. "opieka medyczna" → ["opieka medyczna", "opieki medycznej", "opieką medyczną", "opiekę medyczną", "opiece medycznej"].
- Liczby, sygnatury, kody (np. "226", "EU 1925/2025") → zwróć BEZ ZMIAN jako jedyny element.
- NIE dodawaj synonimów — tylko odmiany tego samego słowa/frazy.

Odpowiedz WYŁĄCZNIE prawidłowym JSON-em: {"terms": {"termin1": ["forma1", "forma2", ...], "termin2": [...]}}`;

/**
 * Parse a boolean search query into a tsquery string.
 * Supports: AND, OR, "quoted phrases", parentheses.
 * Bare words are AND'd by default (like Google).
 *
 * Returns the list of unique terms (for LLM stemming) and a function
 * that builds the final tsquery given the expanded forms.
 */
function parseBooleanQuery(query: string): {
  terms: string[];
  buildTsQuery: (expansions: Record<string, string[]>) => string;
} {
  // Tokenize: extract quoted phrases, operators, parens, and bare words
  const tokenRegex = /"([^"]+)"|(\bAND\b|\bOR\b|\bAND\b|\bOR\b)|([()])|(\S+)/gi;
  const tokens: { type: "term" | "op" | "paren"; value: string }[] = [];
  let match;

  while ((match = tokenRegex.exec(query)) !== null) {
    if (match[1] !== undefined) {
      // Quoted phrase
      tokens.push({ type: "term", value: match[1].trim() });
    } else if (match[2] !== undefined) {
      // AND or OR operator
      tokens.push({ type: "op", value: match[2].toUpperCase() });
    } else if (match[3] !== undefined) {
      // Parenthesis
      tokens.push({ type: "paren", value: match[3] });
    } else if (match[4] !== undefined) {
      const word = match[4];
      // Skip if it's just punctuation
      if (/^[–—,.:;!?]+$/.test(word)) continue;
      tokens.push({ type: "term", value: word });
    }
  }

  // Extract unique terms
  const terms = [...new Set(tokens.filter(t => t.type === "term").map(t => t.value))];

  // Build tsquery from tokens + expansions
  function buildTsQuery(expansions: Record<string, string[]>): string {
    const parts: string[] = [];
    let lastWasTerm = false;

    for (const token of tokens) {
      if (token.type === "paren") {
        if (token.value === "(" && lastWasTerm) {
          parts.push("&"); // implicit AND before paren
        }
        parts.push(token.value);
        lastWasTerm = token.value === ")";
      } else if (token.type === "op") {
        parts.push(token.value === "OR" ? "|" : "&");
        lastWasTerm = false;
      } else {
        // Term — expand into OR'd forms
        if (lastWasTerm) {
          parts.push("&"); // implicit AND between adjacent terms
        }
        const forms = expansions[token.value] || [token.value];
        const expanded = expandWithDiacriticVariants(forms);
        const fragments = expanded
          .map(keywordToTsFragment)
          .filter(Boolean) as string[];
        if (fragments.length === 0) continue;
        if (fragments.length === 1) {
          parts.push(fragments[0]);
        } else {
          parts.push(`( ${fragments.join(" | ")} )`);
        }
        lastWasTerm = true;
      }
    }

    return parts.join(" ");
  }

  return { terms, buildTsQuery };
}

/**
 * LLM pseudo-stemming: expand each term into Polish case forms.
 */
async function expandTermForms(
  terms: string[],
  model?: string,
): Promise<{ expansions: Record<string, string[]>; cost: CostEntry }> {
  if (terms.length === 0) {
    return {
      expansions: {},
      cost: { layer: "stemming", model: "none", input_tokens: 0, output_tokens: 0, cost_usd: 0, latency_ms: 0 },
    };
  }

  const response = await chatCompletion(
    [
      { role: "system", content: SIMPLE_STEMMING_PROMPT },
      { role: "user", content: JSON.stringify(terms) },
    ],
    model || MODELS.QUERY_UNDERSTANDING,
    { temperature: 0, max_tokens: 1024 }
  );

  let expansions: Record<string, string[]> = {};
  try {
    const cleaned = response.content.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    expansions = parsed.terms || parsed;
  } catch {
    console.warn("Simple mode: stemming parse failed, using raw terms");
    for (const t of terms) {
      expansions[t] = [t];
    }
  }

  // Ensure every original term is in its own expansion list
  for (const t of terms) {
    if (!expansions[t]) {
      expansions[t] = [t];
    } else if (!expansions[t].includes(t)) {
      expansions[t].unshift(t);
    }
  }

  return {
    expansions,
    cost: {
      layer: "stemming",
      model: response.model,
      input_tokens: response.input_tokens,
      output_tokens: response.output_tokens,
      cost_usd: response.cost_usd,
      latency_ms: response.latency_ms,
    },
  };
}

/**
 * Simple search mode: boolean FTS with LLM pseudo-stemming.
 * Skips vector search, RRF fusion, and LLM reranking.
 * Uses ts_rank_cd for scoring (simple queries are selective enough).
 */
export async function searchBaseSimple(
  userQuery: string,
  filters?: SearchFilters,
  onStatus?: (status: string) => void,
  queryModel?: string,
): Promise<SearchBaseResult> {
  const startTime = Date.now();
  const costs: CostEntry[] = [];
  let totalTokens = 0;

  // Step 1: Parse boolean query
  onStatus?.("parsing_query");
  const { terms, buildTsQuery: buildQuery } = parseBooleanQuery(userQuery);

  // Step 2: LLM pseudo-stemming
  onStatus?.("expanding_terms");
  const { expansions, cost: stemmingCost } = await expandTermForms(terms, queryModel);
  costs.push(stemmingCost);
  totalTokens += stemmingCost.input_tokens + stemmingCost.output_tokens;

  // Step 3: Build tsquery and execute ranked FTS
  onStatus?.("searching");
  const tsquery = buildQuery(expansions);

  const mergedFilters: SearchFilters = { ...filters };

  const supabase = createAdminClient();
  const dbSearchStart = Date.now();
  const { data, error } = await supabase.rpc("search_chunks_fts", {
    search_query: tsquery,
    match_count: 200,
    filter_type: mergedFilters.document_type || null,
    filter_decision: mergedFilters.decision_type || null,
    filter_date_from: mergedFilters.date_from || null,
    filter_date_to: mergedFilters.date_to || null,
  });

  let ftsResults: ChunkResult[] = [];
  let ftsTimedOut = false;

  if (error?.message?.includes("statement timeout")) {
    console.warn("Simple mode: ranked FTS timeout, trying unranked");
    ftsTimedOut = true;
    // Fallback to unranked
    const { results, timedOut } = await ftsQueryUnranked(tsquery, mergedFilters, 1000);
    ftsTimedOut = timedOut;
    ftsResults = results;
  } else if (error) {
    throw new Error(`Simple FTS error: ${error.message}`);
  } else {
    ftsResults = mapFtsRows(data || []);
  }

  costs.push({
    layer: "db_search",
    model: "fts_ranked",
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    latency_ms: Date.now() - dbSearchStart,
  });

  // Step 4: Group by verdict (no keyword groups = no coverage boost)
  const verdicts = groupByVerdict(ftsResults, 100);

  const sygnaturaMap: Record<string, number> = {};
  for (const v of verdicts) {
    const normalizedKey = normalizeSygnatura(v.sygnatura);
    sygnaturaMap[normalizedKey] = v.verdict_id;
    if (v.sygnatura.includes("|")) {
      for (const part of v.sygnatura.split("|")) {
        const normalized = normalizeSygnatura(part);
        if (normalized && !(normalized in sygnaturaMap)) {
          sygnaturaMap[normalized] = v.verdict_id;
        }
      }
    }
  }

  // Step 5: Envelopes for AI answer
  const envelopes = ftsResults.length > 0
    ? await fetchVerdictEnvelopes(ftsResults)
    : [];

  const summarizeChunks = (chunks: ChunkResult[]) =>
    chunks.map((c) => ({
      sygnatura: c.sygnatura,
      section_label: c.section_label,
      score: c.score,
      chunk_text_preview: c.chunk_text.slice(0, 150),
    }));

  return {
    query: userQuery,
    semanticQuery: userQuery, // no semantic rephrasing in simple mode
    verdicts,
    sygnatura_map: sygnaturaMap,
    fusedChunks: ftsResults,
    envelopes,
    costs,
    totalTokens,
    startTime,
    debug: {
      query_understanding: null,
      fts_results: summarizeChunks(ftsResults),
      vector_results: [],
      fused_results: [],
      reranked_results: [],
      fts_query: tsquery,
      fts_timed_out: ftsTimedOut,
      answer_prompt: envelopes.length > 0 ? buildAnswerMessages(userQuery, userQuery, envelopes) : null,
      simple_mode: {
        original_query: userQuery,
        parsed_terms: terms,
        expansions,
        tsquery,
      },
    },
  };
}

// ============================================================
// Streaming answer generation
// ============================================================

export async function streamAnswer(
  userQuery: string,
  semanticQuery: string,
  envelopes: VerdictEnvelope[],
  answerModel: string,
  maxTokens: number = 8000,
): Promise<{ stream: ReadableStream<Uint8Array>; startTime: number }> {
  const messages = buildAnswerMessages(userQuery, semanticQuery, envelopes);
  return chatCompletionStream(messages, answerModel, {
    temperature: 0.2,
    max_tokens: maxTokens,
  });
}

/**
 * Rebuild envelopes for a given set of verdict IDs and stream a new answer.
 * Used when the user requests AI overview with more verdicts than the default 15.
 */
export async function regenerateEnvelopes(
  verdictIds: number[],
  tokenBudget: number,
): Promise<VerdictEnvelope[]> {
  const supabase = createAdminClient();

  // Fetch all chunks for these verdicts
  const { data: chunks, error } = await supabase
    .from("chunks")
    .select(`
      id, verdict_id, section_label, chunk_position, total_chunks,
      preamble, chunk_text
    `)
    .in("verdict_id", verdictIds)
    .order("verdict_id")
    .order("chunk_position");

  if (error) throw new Error(`Failed to fetch chunks: ${error.message}`);

  // Fetch verdict metadata
  const { data: verdicts, error: vError } = await supabase
    .from("verdicts")
    .select("id, sygnatura, verdict_date, document_type_normalized, decision_type_normalized")
    .in("id", verdictIds);

  if (vError) throw new Error(`Failed to fetch verdicts: ${vError.message}`);

  const verdictMap = new Map(verdicts?.map(v => [v.id, v]) || []);

  // Build envelopes
  const envelopes: VerdictEnvelope[] = [];
  let totalTokens = 0;

  for (const vid of verdictIds) {
    const v = verdictMap.get(vid);
    if (!v) continue;

    const verdictChunks = (chunks || []).filter(c => c.verdict_id === vid);

    // Pick matched chunks (first 3 non-supplementary, or first 3 overall)
    const matchedChunks = verdictChunks
      .filter(c => !["sentencja"].includes(c.section_label))
      .slice(0, ENVELOPE_MAX_MATCHED_PER_VERDICT);

    const matchedLabels = new Set(matchedChunks.map(c => c.section_label));

    // Find supplementary sections
    const sentencjaChunk = verdictChunks.find(c => c.section_label === "sentencja");
    const sentencja = sentencjaChunk && !matchedLabels.has("sentencja")
      ? sentencjaChunk.chunk_text : null;

    const faktyChunk = verdictChunks.find(c => c.section_label === "uzasadnienie_fakty");
    const supplementaryFakty = faktyChunk && !matchedLabels.has("uzasadnienie_fakty")
      ? faktyChunk.chunk_text : null;

    const rozważaniaChunk = verdictChunks.find(c => c.section_label === "uzasadnienie_rozważania");
    const supplementaryRozważania = rozważaniaChunk && !matchedLabels.has("uzasadnienie_rozważania")
      ? rozważaniaChunk.chunk_text : null;

    // Estimate tokens
    let envelopeTokens = 0;
    for (const c of matchedChunks) envelopeTokens += estimateTokens(c.chunk_text);
    if (sentencja) envelopeTokens += estimateTokens(sentencja);
    if (supplementaryFakty) envelopeTokens += estimateTokens(supplementaryFakty);
    if (supplementaryRozważania) envelopeTokens += estimateTokens(supplementaryRozważania);

    if (totalTokens + envelopeTokens > tokenBudget && envelopes.length > 0) break;
    totalTokens += envelopeTokens;

    envelopes.push({
      verdict_id: vid,
      sygnatura: v.sygnatura,
      verdict_date: v.verdict_date,
      document_type_normalized: v.document_type_normalized,
      decision_type_normalized: v.decision_type_normalized,
      sentencja,
      matched_chunks: matchedChunks.map(c => ({
        chunk_text: c.chunk_text,
        section_label: c.section_label,
        chunk_position: c.chunk_position,
        total_chunks: c.total_chunks,
        score: 0,
      })),
      supplementary_fakty: supplementaryFakty,
      supplementary_rozważania: supplementaryRozważania,
    });
  }

  return envelopes;
}

/**
 * Estimate the cost of regenerating with N verdicts.
 * Returns { inputTokens, outputTokens, costUsd } for the given model.
 */
export function estimateRegenerationCost(
  verdictCount: number,
  answerModel: string,
): { inputTokens: number; outputTokens: number; costUsd: number } {
  // ~7,000 tokens per verdict envelope (matched chunks + sentencja + fakty + rozważania) + ~2,000 base
  const inputTokens = 2_000 + verdictCount * 7_000;
  // Output scales: ~500 tokens per verdict, capped at 32K
  const outputTokens = Math.min(Math.max(8_000, verdictCount * 500), 32_000);
  const costUsd = estimateCost(answerModel, inputTokens, outputTokens);
  return { inputTokens, outputTokens, costUsd };
}
