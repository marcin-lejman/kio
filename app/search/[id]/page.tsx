"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  SearchBar,
  AIOverview,
  VerdictCard,
  DebugPanel,
  SearchMetadata,
  FollowUpChat,
} from "@/components/search";
import type { FollowUpMessage } from "@/components/search";
import { AddToFolderDialog } from "@/components/folders/AddToFolderDialog";
import type {
  SearchFilters,
  SearchMode,
  VerdictResult,
  SearchMetadataType,
  DebugData,
} from "@/components/search";
import { parseSygnatura } from "@/lib/sygnatura";

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
    search_mode?: string;
  } | null;
  created_at: string;
  conversations?: { ordinal: number; role: string; content: string; cost_usd?: number }[];
}

// ---------------------------------------------------------------------------
// Progressive search status UI
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, Record<string, string>> = {
  intelligent: {
    query_understanding: "Przygotowuję zapytania do bazy danych",
    searching: "Przeszukuję bazę danych",
    reranking: "Udoskonalam wyniki",
  },
  simple: {
    parsing_query: "Analizuję zapytanie",
    expanding_terms: "Generuję formy fleksyjne",
    searching: "Przeszukuję bazę danych",
  },
};

const STATUS_ORDERS: Record<string, string[]> = {
  intelligent: ["query_understanding", "searching", "reranking"],
  simple: ["parsing_query", "expanding_terms", "searching"],
};

function SearchProgress({ currentStep, mode = "intelligent" }: { currentStep: string; mode?: string }) {
  const statusOrder = STATUS_ORDERS[mode] || STATUS_ORDERS.intelligent;
  const labels = STATUS_LABELS[mode] || STATUS_LABELS.intelligent;
  const currentIndex = statusOrder.indexOf(currentStep);

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      <div className="flex flex-col gap-2">
        {statusOrder.map((key, i) => {
          const isDone = currentIndex >= 0 && i < currentIndex;
          const isCurrent = i === currentIndex;

          return (
            <div
              key={key}
              className={`flex items-center gap-2 text-sm transition-all duration-300 ${
                isDone
                  ? "text-muted"
                  : isCurrent
                  ? "text-primary font-medium"
                  : "text-muted/40"
              }`}
            >
              {isDone ? (
                <svg
                  className="h-4 w-4 text-accent flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              ) : isCurrent ? (
                <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse ml-1 mr-1 flex-shrink-0" />
              ) : (
                <span className="inline-block h-2 w-2 rounded-full bg-muted/20 ml-1 mr-1 flex-shrink-0" />
              )}
              {labels[key]}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function SearchResultPage() {
  const params = useParams();
  const router = useRouter();
  const searchId = params.id as string;
  const isPending = searchId === "pending";

  // Read pending search data synchronously on first render so SearchBar
  // can be initialised with the correct query immediately.
  const pendingDataRef = useRef<{
    query: string;
    filters: SearchFilters;
    answerModel: string;
    searchMode?: SearchMode;
  } | null | undefined>(undefined);

  if (isPending && pendingDataRef.current === undefined) {
    try {
      const json =
        typeof window !== "undefined"
          ? sessionStorage.getItem("pending_search")
          : null;
      pendingDataRef.current = json ? JSON.parse(json) : null;
    } catch {
      pendingDataRef.current = null;
    }
  }

  // Saved search state
  const [saved, setSaved] = useState<SavedSearch | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(!isPending);

  // Search execution state
  const [activeSearchMode, setActiveSearchMode] = useState<SearchMode>(
    pendingDataRef.current?.searchMode || "intelligent"
  );
  const [searchStatus, setSearchStatus] = useState<string | null>(
    isPending ? (pendingDataRef.current?.searchMode === "simple" ? "parsing_query" : "query_understanding") : null
  );
  const [searchError, setSearchError] = useState<string | null>(null);

  // Live results
  const [liveVerdicts, setLiveVerdicts] = useState<VerdictResult[] | null>(
    null
  );
  const [liveSygnaturaMap, setLiveSygnaturaMap] = useState<Record<
    string,
    number
  > | null>(null);
  const [liveAiOverview, setLiveAiOverview] = useState<string | null>(null);
  const [liveAiStreaming, setLiveAiStreaming] = useState(false);
  const [liveAiError, setLiveAiError] = useState(false);
  const [liveUnresolvedRefs, setLiveUnresolvedRefs] = useState<string[]>([]);
  const [liveMetadata, setLiveMetadata] = useState<SearchMetadataType | null>(
    null
  );
  const [liveDebug, setLiveDebug] = useState<DebugData | null>(null);

  const [visibleCount, setVisibleCount] = useState(15);
  const [showAddToFolder, setShowAddToFolder] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const regenAbortRef = useRef<AbortController | null>(null);
  const pendingSearchIdRef = useRef<number | null>(null);

  // Follow-up conversation state
  const [followUpMessages, setFollowUpMessages] = useState<FollowUpMessage[]>([]);
  const [followUpStreaming, setFollowUpStreaming] = useState(false);
  const [followUpStreamContent, setFollowUpStreamContent] = useState("");
  const [followUpPrompt, setFollowUpPrompt] = useState<{ role: string; content: string }[] | null>(null);
  const followUpAbortRef = useRef<AbortController | null>(null);
  // Track the resolved search ID (survives the pending→saved URL transition)
  const resolvedSearchIdRef = useRef<number | null>(isPending ? null : parseInt(searchId, 10) || null);

  const isLive = liveVerdicts !== null;
  const isSearching = searchStatus !== null;

  // ------------------------------------------------------------------
  // Core search execution (used by both pending init and re-search)
  // ------------------------------------------------------------------

  const executeSearch = useCallback(
    async (query: string, filters: SearchFilters, answerModel: string, searchMode: SearchMode = "intelligent") => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setActiveSearchMode(searchMode);
      setSearchStatus(searchMode === "simple" ? "parsing_query" : "query_understanding");
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
      setFollowUpMessages([]);
      setFollowUpStreamContent("");
      setFollowUpPrompt(null);

      let hasReceivedResults = false;

      try {
        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            filters,
            answer_model: answerModel,
            search_mode: searchMode,
          }),
          signal: abort.signal,
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Search failed");
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // Persist across reads so split event:/data: lines still pair up
        let currentEvent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7);
            } else if (line.startsWith("data: ")) {
              const data = line.slice(6);
              try {
                const parsed = JSON.parse(data);

                if (currentEvent === "status") {
                  setSearchStatus(parsed.step);
                } else if (currentEvent === "results") {
                  hasReceivedResults = true;
                  setLiveVerdicts(parsed.verdicts);
                  setLiveSygnaturaMap(parsed.sygnatura_map || {});
                  setLiveMetadata(parsed.metadata);
                  setLiveDebug(parsed.debug);
                  setSearchStatus(null);
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
                    pendingSearchIdRef.current = parsed.search_id;
                    resolvedSearchIdRef.current = parsed.search_id;
                  }
                } else if (currentEvent === "error") {
                  setSearchStatus(null);
                  if (!hasReceivedResults) {
                    setSearchError(
                      parsed.message || "Wystąpił błąd wyszukiwania"
                    );
                  } else {
                    setLiveAiStreaming(false);
                    setLiveAiError(true);
                  }
                }
              } catch {
                // skip unparseable
              }
            }
          }
        }
      } catch (err) {
        if (abort.signal.aborted) return;
        setSearchError(
          err instanceof Error ? err.message : "Wystąpił błąd"
        );
        setSearchStatus(null);
      } finally {
        if (!abort.signal.aborted) {
          setSearchStatus(null);
          setLiveAiStreaming(false);
          if (pendingSearchIdRef.current) {
            // Use replaceState instead of router.replace to avoid
            // unmounting the component (which would lose live state).
            window.history.replaceState(
              null,
              "",
              `/search/${pendingSearchIdRef.current}`
            );
            pendingSearchIdRef.current = null;
          }
        }
      }
    },
    []
  );

  // ------------------------------------------------------------------
  // Pending search: read sessionStorage and start search
  // ------------------------------------------------------------------

  useEffect(() => {
    if (!isPending) return;

    const data = pendingDataRef.current;
    if (!data) {
      router.replace("/");
      return;
    }

    sessionStorage.removeItem("pending_search");
    executeSearch(data.query, data.filters || {}, data.answerModel || "", data.searchMode || "intelligent");

    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // Load saved search (for non-pending pages)
  // ------------------------------------------------------------------

  useEffect(() => {
    if (isPending) return;

    async function loadSearch() {
      try {
        const res = await fetch(`/api/search/${searchId}`);
        if (!res.ok) {
          setLoadError(
            res.status === 404
              ? "Wyszukiwanie nie zostało znalezione."
              : "Nie udało się załadować wyników."
          );
          return;
        }
        const data: SavedSearch = await res.json();
        setSaved(data);
        // Load saved conversation messages
        if (data.conversations && data.conversations.length > 0) {
          setFollowUpMessages(
            data.conversations.map(c => ({
              role: c.role as "user" | "assistant",
              content: c.content,
              cost_usd: c.cost_usd ? Number(c.cost_usd) : undefined,
            }))
          );
        }
      } catch {
        setLoadError("Nie udało się załadować wyników.");
      } finally {
        setPageLoading(false);
      }
    }
    loadSearch();
  }, [searchId, isPending]);

  // Abort on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ------------------------------------------------------------------
  // Re-search handler (from SearchBar on this page)
  // ------------------------------------------------------------------

  const handleSearch = useCallback(
    async (query: string, filters: SearchFilters, answerModel: string, searchMode: SearchMode = "intelligent") => {
      const syg = parseSygnatura(query);
      if (syg) {
        setSearchStatus("query_understanding");
        try {
          const res = await fetch(
            `/api/verdict/by-sygnatura?q=${encodeURIComponent(syg)}`
          );
          const data = await res.json();
          if (data.found) {
            router.push(`/verdict/${data.verdict_id}`);
            return;
          }
        } catch {
          // fall through to normal search
        } finally {
          setSearchStatus(null);
        }
      }

      executeSearch(query, filters, answerModel, searchMode);
    },
    [executeSearch, router]
  );

  // ------------------------------------------------------------------
  // Regenerate AI answer with more verdicts
  // ------------------------------------------------------------------

  const handleRegenerate = useCallback(
    async (verdictCount: number) => {
      const currentVerdicts = isLive ? liveVerdicts : saved?.result_data?.verdicts;
      if (!currentVerdicts || currentVerdicts.length === 0) return;

      regenAbortRef.current?.abort();
      const abort = new AbortController();
      regenAbortRef.current = abort;

      setRegenerating(true);
      setLiveAiError(false);
      setLiveUnresolvedRefs([]);
      setFollowUpMessages([]);
      setFollowUpStreamContent("");
      setFollowUpPrompt(null);
      let firstToken = true;

      const verdictIds = currentVerdicts.slice(0, verdictCount).map(v => v.verdict_id);
      const model = pendingDataRef.current?.answerModel || saved?.answer_model || "";
      const query = isLive ? (pendingDataRef.current?.query || "") : (saved?.query || "");

      try {
        const response = await fetch("/api/search/regenerate-answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            verdict_ids: verdictIds,
            query,
            answer_model: model,
            verdict_count: verdictCount,
          }),
          signal: abort.signal,
        });

        if (!response.ok) {
          throw new Error("Regeneration failed");
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7);
            } else if (line.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (currentEvent === "token") {
                  if (firstToken) {
                    setLiveAiOverview(parsed);
                    firstToken = false;
                  } else {
                    setLiveAiOverview((prev) => (prev || "") + parsed);
                  }
                } else if (currentEvent === "done") {
                  if (parsed.ai_overview != null) {
                    setLiveAiOverview(parsed.ai_overview);
                  }
                  if (parsed.answer_prompt) {
                    setLiveDebug((prev) => prev ? {
                      ...prev,
                      answer_prompt: parsed.answer_prompt,
                    } : prev);
                  }
                  if (parsed.metadata) {
                    setLiveMetadata((prev) => {
                      if (!prev) return parsed.metadata;
                      // Append regeneration cost to existing costs
                      return {
                        ...prev,
                        time_ms: prev.time_ms + parsed.metadata.time_ms,
                        tokens_used: prev.tokens_used + parsed.metadata.tokens_used,
                        cost_usd: prev.cost_usd + parsed.metadata.cost_usd,
                        costs: [...prev.costs, ...parsed.metadata.costs],
                      };
                    });
                  }
                } else if (currentEvent === "error") {
                  setLiveAiError(true);
                }
              } catch {
                // skip
              }
            }
          }
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          setLiveAiError(true);
          console.error("Regeneration error:", err);
        }
      } finally {
        if (!abort.signal.aborted) {
          setRegenerating(false);
        }
      }
    },
    [isLive, liveVerdicts, saved]
  );

  // ------------------------------------------------------------------
  // Follow-up conversation
  // ------------------------------------------------------------------

  const executeFollowUp = useCallback(
    async (message: string) => {
      const currentSearchId = resolvedSearchIdRef.current;
      if (!currentSearchId) return;

      followUpAbortRef.current?.abort();
      const abort = new AbortController();
      followUpAbortRef.current = abort;

      // Optimistically add user message
      setFollowUpMessages(prev => [...prev, { role: "user", content: message }]);
      setFollowUpStreaming(true);
      setFollowUpStreamContent("");

      try {
        const response = await fetch(`/api/search/${currentSearchId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
          signal: abort.signal,
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Follow-up failed");
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "";
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7);
            } else if (line.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (currentEvent === "token") {
                  fullContent += parsed;
                  setFollowUpStreamContent(fullContent);
                } else if (currentEvent === "done") {
                  const content = parsed.content || fullContent;
                  setFollowUpMessages(prev => [
                    ...prev,
                    {
                      role: "assistant",
                      content,
                      cost_usd: parsed.cost_usd || 0,
                    },
                  ]);
                  // Update metadata with accumulated cost
                  if (parsed.cost_usd) {
                    setLiveMetadata(prev => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        tokens_used: prev.tokens_used + (parsed.input_tokens || 0) + (parsed.output_tokens || 0),
                        cost_usd: prev.cost_usd + parsed.cost_usd,
                        costs: [...prev.costs, {
                          layer: "follow_up_chat",
                          model: "",
                          input_tokens: parsed.input_tokens || 0,
                          output_tokens: parsed.output_tokens || 0,
                          cost_usd: parsed.cost_usd,
                          latency_ms: parsed.latency_ms || 0,
                        }],
                      };
                    });
                  }
                  if (parsed.follow_up_prompt) {
                    setFollowUpPrompt(parsed.follow_up_prompt);
                  }
                } else if (currentEvent === "error") {
                  // Replace the optimistic user message's expected answer with error
                  setFollowUpMessages(prev => [
                    ...prev,
                    { role: "assistant", content: "", error: true },
                  ]);
                }
              } catch {
                // skip
              }
            }
          }
        }
      } catch (err) {
        if (abort.signal.aborted) return;
        // Add error response
        setFollowUpMessages(prev => [
          ...prev,
          { role: "assistant", content: "", error: true },
        ]);
        console.error("Follow-up error:", err);
      } finally {
        if (!abort.signal.aborted) {
          setFollowUpStreaming(false);
          setFollowUpStreamContent("");
        }
      }
    },
    [] // resolvedSearchIdRef is a ref, stable across renders
  );

  // Abort follow-up on unmount
  useEffect(() => {
    return () => {
      followUpAbortRef.current?.abort();
    };
  }, []);

  // ------------------------------------------------------------------
  // Render: loading saved search
  // ------------------------------------------------------------------

  if (pageLoading && !isPending && !isLive) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="text-sm text-muted">Ładowanie wyników...</p>
        </div>
      </div>
    );
  }

  // Render: error loading saved search
  if (
    !isLive &&
    !isSearching &&
    !isPending &&
    !pageLoading &&
    (loadError || !saved)
  ) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="rounded-lg border border-error/30 bg-error/5 p-4 text-sm text-error">
          {loadError || "Wyszukiwanie nie zostało znalezione."}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Determine display data
  // ------------------------------------------------------------------

  const verdicts = isLive
    ? liveVerdicts!
    : saved?.result_data?.verdicts || [];
  const sygnaturaMap = isLive
    ? liveSygnaturaMap || {}
    : saved?.result_data?.sygnatura_map || {};
  const aiOverview = isLive
    ? liveAiOverview || ""
    : saved?.ai_answer || "";
  const aiStreaming = isLive ? liveAiStreaming : false;
  const aiError = isLive ? liveAiError : false;
  const metadata = isLive
    ? liveMetadata
    : saved?.result_data?.metadata || null;
  const debug = isLive ? liveDebug : saved?.result_data?.debug || null;

  const formattedDate = saved
    ? new Date(saved.created_at).toLocaleDateString("pl-PL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  // SearchBar initial values: from pending data or saved search
  const searchBarQuery = isPending
    ? pendingDataRef.current?.query || ""
    : saved?.query || "";
  const searchBarFilters = isPending
    ? pendingDataRef.current?.filters || undefined
    : saved?.filters || undefined;
  const searchBarModel = isPending
    ? pendingDataRef.current?.answerModel || undefined
    : saved?.answer_model || undefined;
  const searchBarMode = isPending
    ? pendingDataRef.current?.searchMode || undefined
    : (saved?.result_data?.search_mode as SearchMode | undefined) || undefined;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <SearchBar
          key={searchBarQuery}
          onSearch={handleSearch}
          loading={isSearching}
          initialQuery={searchBarQuery}
          initialFilters={searchBarFilters}
          initialModel={searchBarModel}
          initialSearchMode={searchBarMode}
        />
      </div>

      {/* Progressive search status */}
      {isSearching && searchStatus && (
        <SearchProgress currentStep={searchStatus} mode={activeSearchMode} />
      )}

      {/* Search error */}
      {searchError && (
        <div className="rounded-lg border border-error/30 bg-error/5 p-4 text-sm text-error mb-6">
          {searchError}
        </div>
      )}

      {/* Saved results indicator (only when showing saved, not live, not searching) */}
      {!isLive && !isSearching && saved && (
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>{formattedDate}</span>
            <span>&middot;</span>
            <button
              onClick={() =>
                handleSearch(
                  saved.query,
                  saved.filters || {},
                  saved.answer_model || ""
                )
              }
              className="text-accent hover:underline"
            >
              Odśwież wyniki
            </button>
          </div>
          {metadata && <SearchMetadata metadata={metadata} />}
        </div>
      )}

      {/* Results */}
      {!isSearching && verdicts.length > 0 && (
        <div className="space-y-6">
          {isLive && metadata && (
            <div className="flex justify-end">
              <SearchMetadata metadata={metadata} />
            </div>
          )}

          <AIOverview
            overview={aiOverview}
            streaming={aiStreaming}
            error={aiError}
            sygnaturaMap={sygnaturaMap}
            unresolvedRefs={isLive ? liveUnresolvedRefs : undefined}
            onSaveToFolder={() => setShowAddToFolder(true)}
            totalResults={verdicts.length}
            answerModel={
              (isPending ? pendingDataRef.current?.answerModel : saved?.answer_model) || undefined
            }
            onRegenerate={handleRegenerate}
            regenerating={regenerating}
          />

          {/* Follow-up conversation */}
          {!aiStreaming && !regenerating && aiOverview && !aiError && (
            <FollowUpChat
              messages={followUpMessages}
              streaming={followUpStreaming}
              streamContent={followUpStreamContent}
              onSend={executeFollowUp}
              sygnaturaMap={sygnaturaMap}
              disabled={isSearching || aiStreaming || regenerating}
              onRetry={executeFollowUp}
            />
          )}

          {debug && <DebugPanel debug={debug} followUpPrompt={followUpPrompt} />}

          <p className="text-sm text-muted">
            Znaleziono {verdicts.length} orzeczeń
          </p>

          <div className="space-y-3">
            {verdicts.slice(0, visibleCount).map((verdict) => (
              <VerdictCard
                key={verdict.verdict_id}
                verdict={verdict}
                keywords={
                  debug?.query_understanding?.keywords
                  || (debug?.simple_mode ? Object.values(debug.simple_mode.expansions).flat() : undefined)
                }
              />
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

      {!isSearching && verdicts.length === 0 && !isLive && saved && (
        <div className="text-center py-12">
          <p className="text-muted">
            Nie znaleziono orzeczeń pasujących do zapytania.
          </p>
        </div>
      )}

      <AddToFolderDialog
        isOpen={showAddToFolder}
        onClose={() => setShowAddToFolder(false)}
        mode={{
          type: "search",
          searchId: isPending ? (pendingSearchIdRef.current || 0) : parseInt(searchId, 10),
          query: saved?.query || pendingDataRef.current?.query || "",
        }}
      />
    </div>
  );
}
