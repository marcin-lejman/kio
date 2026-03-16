"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
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

export default function SearchPage() {
  const router = useRouter();
  const [verdicts, setVerdicts] = useState<VerdictResult[]>([]);
  const [sygnaturaMap, setSygnaturaMap] = useState<Record<string, number>>({});
  const [aiOverview, setAiOverview] = useState("");
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiError, setAiError] = useState(false);
  const [unresolvedRefs, setUnresolvedRefs] = useState<string[]>([]);
  const [metadata, setMetadata] = useState<SearchMetadataType | null>(null);
  const [debug, setDebug] = useState<DebugData | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasResults, setHasResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(15);
  const [verdictCount, setVerdictCount] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingSearchIdRef = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d) => setVerdictCount(d.verdict_count))
      .catch(() => {});
  }, []);

  const handleSearch = useCallback(
    async (query: string, filters: SearchFilters, answerModel: string) => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setLoading(true);
      setError(null);
      setVerdicts([]);
      setSygnaturaMap({});
      setAiOverview("");
      setAiStreaming(false);
      setUnresolvedRefs([]);
      setAiError(false);
      setMetadata(null);
      setDebug(null);
      setHasResults(false);
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
                  setVerdicts(parsed.verdicts);
                  setSygnaturaMap(parsed.sygnatura_map || {});
                  setMetadata(parsed.metadata);
                  setDebug(parsed.debug);
                  setHasResults(true);
                  setLoading(false);
                  setAiStreaming(true);
                } else if (currentEvent === "token") {
                  setAiOverview((prev) => prev + parsed);
                } else if (currentEvent === "done") {
                  setAiStreaming(false);
                  if (parsed.ai_overview != null) {
                    setAiOverview(parsed.ai_overview);
                  }
                  if (parsed.unresolved_refs) {
                    setUnresolvedRefs(parsed.unresolved_refs);
                  }
                  setMetadata(parsed.metadata);
                  if (parsed.search_id) {
                    pendingSearchIdRef.current = parsed.search_id;
                  }
                } else if (currentEvent === "error") {
                  setAiStreaming(false);
                  setAiError(true);
                }
              } catch {
                // skip unparseable
              }
            }
          }
        }
      } catch (err) {
        if (abort.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Wystąpił błąd");
      } finally {
        if (!abort.signal.aborted) {
          setLoading(false);
          setAiStreaming(false);
          // Navigate to the saved search page after stream is fully complete
          if (pendingSearchIdRef.current) {
            router.replace(`/search/${pendingSearchIdRef.current}`, { scroll: false });
            pendingSearchIdRef.current = null;
          }
        }
      }
    },
    [router]
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        {!hasResults && !loading && (
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold text-primary mb-2">
              Wyszukiwarka orzeczeń KIO
            </h1>
            <p className="text-sm text-muted">
              Przeszukaj{" "}
              {verdictCount !== null
                ? `${verdictCount.toLocaleString("pl-PL")} orzeczeń`
                : "bazę orzeczeń"}{" "}
              Krajowej Izby Odwoławczej
            </p>
          </div>
        )}
        <SearchBar onSearch={handleSearch} loading={loading} />
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="text-sm text-muted">
            Analizuję zapytanie i przeszukuję orzeczenia...
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/5 p-4 text-sm text-error">
          {error}
        </div>
      )}

      {hasResults && (
        <div className="space-y-6">
          {metadata && (
            <div className="flex justify-end">
              <SearchMetadata metadata={metadata} />
            </div>
          )}

          <AIOverview
            overview={aiOverview}
            streaming={aiStreaming}
            error={aiError}
            sygnaturaMap={sygnaturaMap}
            unresolvedRefs={unresolvedRefs}
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

          {verdicts.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted">
                Nie znaleziono orzeczeń pasujących do zapytania.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
