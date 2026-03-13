"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

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

export default function VerdictPage() {
  const params = useParams();
  const id = params.id as string;
  const [verdict, setVerdict] = useState<VerdictDetail | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"text" | "html" | "chunks">("html");

  useEffect(() => {
    async function fetchVerdict() {
      try {
        const response = await fetch(`/api/verdict/${id}`);
        if (!response.ok) throw new Error("Verdict not found");
        const data = await response.json();
        setVerdict(data.verdict);
        setChunks(data.chunks);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    fetchVerdict();
  }, [id]);

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
            {(["html", "text", "chunks"] as const).map((mode) => (
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
            <div
              className="rounded-lg border border-border bg-card p-6 sm:p-8 text-[15px] verdict-html"
              dangerouslySetInnerHTML={{ __html: verdict.original_html }}
            />
          )}

          {viewMode === "html" && !verdict.original_html && (
            <p className="text-muted text-sm">Wersja HTML niedostępna.</p>
          )}

          {viewMode === "chunks" && (
            <div className="space-y-3">
              {chunks.map((chunk) => (
                <div
                  key={chunk.id}
                  className="rounded-lg border border-border bg-card p-4"
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
                    {chunk.chunk_text}
                  </p>
                </div>
              ))}
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
        </aside>
      </div>
    </div>
  );
}
