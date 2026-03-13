"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  SearchBar,
  AIOverview,
  VerdictCard,
  DebugPanel,
  SearchMetadata,
} from "@/components/search";
import type {
  SearchFilters,
  VerdictResult,
  SearchMetadataType,
  DebugData,
} from "@/components/search";

interface SavedSearch {
  id: number;
  query: string;
  filters: SearchFilters | null;
  ai_answer: string | null;
  ai_status: string;
  answer_model: string | null;
  result_data: {
    verdicts: VerdictResult[];
    sygnatura_map: Record<string, number>;
    debug: DebugData;
    metadata: SearchMetadataType;
  } | null;
  created_at: string;
}

export default function SavedSearchPage() {
  const params = useParams();
  const router = useRouter();
  const searchId = params.id as string;

  // Saved search state
  const [saved, setSaved] = useState<SavedSearch | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  // Live search state (when re-searching from this page)
  const [liveVerdicts, setLiveVerdicts] = useState<VerdictResult[] | null>(null);
  const [liveSygnaturaMap, setLiveSygnaturaMap] = useState<Record<string, number> | null>(null);
  const [liveAiOverview, setLiveAiOverview] = useState<string | null>(null);
  const [liveAiStreaming, setLiveAiStreaming] = useState(false);
  const [liveAiError, setLiveAiError] = useState(false);
  const [liveUnresolvedRefs, setLiveUnresolvedRefs] = useState<string[]>([]);
  const [liveMetadata, setLiveMetadata] = useState<SearchMetadataType | null>(null);
  const [liveDebug, setLiveDebug] = useState<DebugData | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(15);
  const abortRef = useRef<AbortController | null>(null);

  // Is showing live results or saved?
  const isLive = liveVerdicts !== null;

  useEffect(() => {
    async function loadSearch() {
      try {
        const res = await fetch(`/api/search/${searchId}`);
        if (!res.ok) {
          setLoadError(res.status === 404 ? "Wyszukiwanie nie zostało znalezione." : "Nie udało się załadować wyników.");
          return;
        }
        const data: SavedSearch = await res.json();
        setSaved(data);
      } catch {
        setLoadError("Nie udało się załadować wyników.");
      } finally {
        setPageLoading(false);
      }
    }
    loadSearch();
  }, [searchId]);

  const handleSearch = useCallback(
    async (query: string, filters: SearchFilters, answerModel: string) => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setSearchLoading(true);
      setSearchError(null);
      setLiveVerdicts(null);
      setLiveSygnaturaMap(null);
      setLiveAiOverview(null);
      setLiveAiStreaming(false);
      setLiveAiError(false);
      setLiveUnresolvedRefs([]);
      setLiveMetadata(null);
      setLiveDebug(null);
      setVisibleCount(15);

      try {
        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, filters, answer_model: answerModel }),
          signal: abort.signal,
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Search failed");
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7);
            } else if (line.startsWith("data: ")) {
              const data = line.slice(6);
              try {
                const parsed = JSON.parse(data);

                if (currentEvent === "results") {
                  setLiveVerdicts(parsed.verdicts);
                  setLiveSygnaturaMap(parsed.sygnatura_map || {});
                  setLiveMetadata(parsed.metadata);
                  setLiveDebug(parsed.debug);
                  setSearchLoading(false);
                  setLiveAiStreaming(true);
                } else if (currentEvent === "token") {
                  setLiveAiOverview((prev) => (prev || "") + parsed);
                } else if (currentEvent === "done") {
                  setLiveAiStreaming(false);
                  if (parsed.ai_overview != null) {
                    setLiveAiOverview(parsed.ai_overview);
                  }
                  if (parsed.unresolved_refs) {
                    setLiveUnresolvedRefs(parsed.unresolved_refs);
                  }
                  setLiveMetadata(parsed.metadata);
                  if (parsed.search_id) {
                    router.replace(`/search/${parsed.search_id}`);
                  }
                } else if (currentEvent === "error") {
                  setLiveAiStreaming(false);
                  setLiveAiError(true);
                }
              } catch {
                // skip unparseable
              }
            }
          }
        }
      } catch (err) {
        if (abort.signal.aborted) return;
        setSearchError(err instanceof Error ? err.message : "Wystąpił błąd");
      } finally {
        if (!abort.signal.aborted) {
          setSearchLoading(false);
          setLiveAiStreaming(false);
        }
      }
    },
    [router]
  );

  // Loading state
  if (pageLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="text-sm text-muted">Ładowanie wyników...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (loadError || !saved) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="rounded-lg border border-error/30 bg-error/5 p-4 text-sm text-error">
          {loadError || "Wyszukiwanie nie zostało znalezione."}
        </div>
      </div>
    );
  }

  // Determine what to display
  const verdicts = isLive ? liveVerdicts! : (saved.result_data?.verdicts || []);
  const sygnaturaMap = isLive ? (liveSygnaturaMap || {}) : (saved.result_data?.sygnatura_map || {});
  const aiOverview = isLive ? (liveAiOverview || "") : (saved.ai_answer || "");
  const aiStreaming = isLive ? liveAiStreaming : false;
  const aiError = isLive ? liveAiError : false;
  const metadata = isLive ? liveMetadata : (saved.result_data?.metadata || null);
  const debug = isLive ? liveDebug : (saved.result_data?.debug || null);

  const formattedDate = new Date(saved.created_at).toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <SearchBar
          onSearch={handleSearch}
          loading={searchLoading}
          initialQuery={saved.query}
          initialFilters={saved.filters || undefined}
          initialModel={saved.answer_model || undefined}
        />
      </div>

      {/* Search loading */}
      {searchLoading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="text-sm text-muted">
            Analizuję zapytanie i przeszukuję orzeczenia...
          </p>
        </div>
      )}

      {/* Search error */}
      {searchError && (
        <div className="rounded-lg border border-error/30 bg-error/5 p-4 text-sm text-error mb-6">
          {searchError}
        </div>
      )}

      {/* Saved results indicator + metadata (only when showing saved, not live) */}
      {!isLive && !searchLoading && (
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>{formattedDate}</span>
            <span>·</span>
            <button
              onClick={() => handleSearch(saved.query, saved.filters || {}, saved.answer_model || "")}
              className="text-accent hover:underline"
            >
              Odśwież wyniki
            </button>
          </div>
          {metadata && <SearchMetadata metadata={metadata} />}
        </div>
      )}

      {/* Results */}
      {!searchLoading && verdicts.length > 0 && (
        <div className="space-y-6">
          <AIOverview
            overview={aiOverview}
            streaming={aiStreaming}
            error={aiError}
            sygnaturaMap={sygnaturaMap}
            unresolvedRefs={isLive ? liveUnresolvedRefs : undefined}
          />

          {debug && <DebugPanel debug={debug} />}

          <p className="text-sm text-muted">
            Znaleziono {verdicts.length} orzeczeń
          </p>

          <div className="space-y-3">
            {verdicts.slice(0, visibleCount).map((verdict) => (
              <VerdictCard key={verdict.verdict_id} verdict={verdict} keywords={debug?.query_understanding?.keywords} />
            ))}
          </div>

          {visibleCount < verdicts.length && (
            <div className="text-center">
              <button
                onClick={() => setVisibleCount((prev) => prev + 15)}
                className="text-sm text-accent hover:underline"
              >
                Pokaż więcej wyników ({visibleCount} z {verdicts.length})
              </button>
            </div>
          )}
        </div>
      )}

      {!searchLoading && verdicts.length === 0 && !isLive && (
        <div className="text-center py-12">
          <p className="text-muted">
            Nie znaleziono orzeczeń pasujących do zapytania.
          </p>
        </div>
      )}
    </div>
  );
}
