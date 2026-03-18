"use client";

import { useEffect, useState, useMemo, useCallback, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import { buildKeywordPattern, highlightKeywords } from "@/lib/highlight";
import { SimilarVerdicts } from "@/components/verdict/SimilarVerdicts";

const summaryComponents: Components = {
  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
  h2: ({ children }) => <h3 className="font-semibold text-base mb-2 mt-4 first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="font-semibold text-sm mb-2 mt-3 first:mt-0">{children}</h4>,
};

interface VerdictDetail {
  id: number;
  document_id: number;
  sygnatura: string;
  verdict_date: string;
  document_type: string;
  document_type_normalized: string;
  decision_type: string;
  decision_type_normalized: string;
  word_count: number;
  chunking_tier: string;
  metadata: Record<string, unknown> | null;
  original_text: string | null;
  original_html: string | null;
}

interface Chunk {
  id: number;
  section_label: string;
  chunk_position: number;
  total_chunks: number;
  preamble: string;
  chunk_text: string;
  word_count: number;
  token_count: number;
}

function MetadataItem({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-muted uppercase tracking-wide">{label}</dt>
      <dd className="text-sm mt-0.5">{value}</dd>
    </div>
  );
}

function VerdictContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const targetChunk = searchParams.get("chunk");
  const hlKeywords = useMemo(
    () => searchParams.get("hl")?.split(",").filter(Boolean) || [],
    [searchParams]
  );
  const hlPattern = useMemo(
    () => buildKeywordPattern(hlKeywords),
    [hlKeywords]
  );

  const [verdict, setVerdict] = useState<VerdictDetail | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"text" | "html" | "chunks" | "summary">(
    targetChunk ? "chunks" : "html"
  );
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);

  useEffect(() => {
    async function fetchVerdict() {
      try {
        const response = await fetch(`/api/verdict/${id}`);
        if (!response.ok) throw new Error("Verdict not found");
        const data = await response.json();
        setVerdict(data.verdict);
        setChunks(data.chunks);

        // Fetch existing summary in parallel
        fetch(`/api/verdict/${id}/summary`)
          .then((res) => res.json())
          .then((data) => {
            if (data.summary) setSummary(data.summary);
          })
          .catch(() => {});
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    fetchVerdict();
  }, [id]);

  const generateSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(false);
    try {
      const res = await fetch(`/api/verdict/${id}/summary`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSummary(data.summary);
      setViewMode("summary");
    } catch {
      setSummaryError(true);
    } finally {
      setSummaryLoading(false);
    }
  }, [id]);

  // Scroll to target chunk after data loads
  useEffect(() => {
    if (!targetChunk || chunks.length === 0 || viewMode !== "chunks") return;
    const el = document.getElementById(`chunk-${targetChunk}`);
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, [chunks, targetChunk, viewMode]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (error || !verdict) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-error">{error || "Nie znaleziono orzeczenia"}</p>
        <Link href="/" className="text-accent hover:underline text-sm mt-2 inline-block">
          Wróć do wyszukiwarki
        </Link>
      </div>
    );
  }

  const meta = verdict.metadata as Record<string, string> | null;

  const decisionLabel: Record<string, string> = {
    oddalone: "Oddalone",
    uwzglednione: "Uwzględnione",
    umorzone: "Umorzone",
    odrzucone: "Odrzucone",
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <Link href="/" className="text-sm text-muted hover:text-foreground mb-4 inline-block">
        &larr; Wróć do wyszukiwarki
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        {/* Main content */}
        <div>
          <h1 className="text-xl font-semibold text-primary mb-1">
            {verdict.sygnatura}
          </h1>
          <p className="text-sm text-muted mb-4">
            {verdict.document_type} z dnia {verdict.verdict_date}
          </p>

          {/* View mode tabs */}
          <div className="flex gap-1 border-b border-border mb-4">
            {(["html", "text", "chunks", ...(summary ? ["summary" as const] : [])] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-2 text-sm transition-colors border-b-2 -mb-[1px] ${
                  viewMode === mode
                    ? "border-accent text-accent font-medium"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {mode === "html" && "HTML"}
                {mode === "text" && "Wersja bez formatowania"}
                {mode === "chunks" && `Fragmenty (${chunks.length})`}
                {mode === "summary" && "Podsumowanie"}
              </button>
            ))}
          </div>

          {/* Content */}
          {viewMode === "text" && verdict.original_text && (
            <div className="rounded-lg border border-border bg-card p-6">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">
                {verdict.original_text}
              </pre>
            </div>
          )}

          {viewMode === "text" && !verdict.original_text && (
            <p className="text-muted text-sm">Pełny tekst niedostępny.</p>
          )}

          {viewMode === "html" && verdict.original_html && (
            <div className="relative">
              {!summary && (
                <div className="absolute top-4 right-4 z-10">
                  <button
                    onClick={generateSummary}
                    disabled={summaryLoading}
                    className="flex items-center gap-1.5 rounded-md border border-border bg-card/90 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-muted hover:text-accent hover:border-accent/40 transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {summaryLoading ? (
                      <>
                        <span className="h-3 w-3 animate-spin rounded-full border border-accent border-t-transparent" />
                        Generuję...
                      </>
                    ) : (
                      <>
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
                        </svg>
                        Generuj podsumowanie
                      </>
                    )}
                  </button>
                  {summaryError && (
                    <p className="mt-1 text-[10px] text-red-500 text-right">
                      Nie udało się wygenerować
                    </p>
                  )}
                </div>
              )}
              <div
                className="rounded-lg border border-border bg-card p-6 sm:p-8 text-[15px] verdict-html"
                dangerouslySetInnerHTML={{ __html: verdict.original_html }}
              />
            </div>
          )}

          {viewMode === "html" && !verdict.original_html && (
            <p className="text-muted text-sm">Wersja HTML niedostępna.</p>
          )}

          {viewMode === "summary" && summary && (
            <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
              <div className="text-sm leading-relaxed">
                <ReactMarkdown components={summaryComponents}>{summary}</ReactMarkdown>
              </div>
            </div>
          )}

          {viewMode === "chunks" && (
            <div className="space-y-3">
              {chunks.map((chunk) => {
                const isTarget = String(chunk.chunk_position) === targetChunk;
                return (
                  <div
                    key={chunk.id}
                    id={`chunk-${chunk.chunk_position}`}
                    className={`rounded-lg border bg-card p-4 transition-colors ${
                      isTarget
                        ? "border-accent ring-2 ring-accent/20"
                        : "border-border"
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xs font-medium text-accent bg-accent/10 px-2 py-0.5 rounded">
                        {chunk.section_label}
                      </span>
                      <span className="text-xs text-muted">
                        Fragment {chunk.chunk_position}/{chunk.total_chunks}
                      </span>
                      <span className="text-xs text-muted">
                        {chunk.token_count} tokenów
                      </span>
                    </div>
                    {chunk.preamble && (
                      <p className="text-xs text-muted italic mb-2">
                        {chunk.preamble}
                      </p>
                    )}
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {isTarget && hlPattern
                        ? highlightKeywords(chunk.chunk_text, hlPattern)
                        : chunk.chunk_text}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold mb-3 text-primary">Metadane</h2>
            <dl className="space-y-3">
              <MetadataItem label="Sygnatura" value={verdict.sygnatura} />
              <MetadataItem label="Data" value={verdict.verdict_date} />
              <MetadataItem label="Typ dokumentu" value={verdict.document_type} />
              <MetadataItem
                label="Rozstrzygnięcie"
                value={
                  decisionLabel[verdict.decision_type_normalized] ||
                  verdict.decision_type
                }
              />
              <MetadataItem
                label="Przewodniczący"
                value={meta?.chairman as string}
              />
              <MetadataItem
                label="Zamawiający"
                value={meta?.contracting_authority as string}
              />
              <MetadataItem label="Miasto" value={meta?.city as string} />
              <MetadataItem
                label="Tryb"
                value={meta?.procedure_type as string}
              />
              <MetadataItem
                label="Liczba słów"
                value={verdict.word_count?.toLocaleString()}
              />
              <MetadataItem label="Tier chunking" value={verdict.chunking_tier} />
            </dl>
          </div>

          {meta?.key_regulations && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold mb-2 text-primary">
                Regulacje
              </h2>
              <div className="flex flex-wrap gap-1">
                {(meta.key_regulations as unknown as string[]).map((reg, i) => (
                  <span
                    key={i}
                    className="text-xs bg-muted/10 text-muted px-2 py-0.5 rounded"
                  >
                    {reg}
                  </span>
                ))}
              </div>
            </div>
          )}

          {meta?.subject_matters && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold mb-2 text-primary">
                Tematy
              </h2>
              <div className="flex flex-wrap gap-1">
                {(meta.subject_matters as unknown as string[]).map((sub, i) => (
                  <span
                    key={i}
                    className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded"
                  >
                    {sub}
                  </span>
                ))}
              </div>
            </div>
          )}

          <SimilarVerdicts verdictId={verdict.id} />
        </aside>
      </div>
    </div>
  );
}

export default function VerdictPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      }
    >
      <VerdictContent />
    </Suspense>
  );
}
