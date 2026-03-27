"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AnalysisMarkdown } from "@/components/folders/AnalysisMarkdown";
import { FollowUpChat, SearchMetadata } from "@/components/search";
import type { FollowUpMessage } from "@/components/search/FollowUpChat";
import type { FolderAnalysis } from "@/components/folders/types";

const statusLabels: Record<string, { label: string; color: string }> = {
  completed: { label: "Zakończona", color: "bg-success/10 text-success" },
  running: { label: "W trakcie", color: "bg-accent/10 text-accent" },
  error: { label: "Błąd", color: "bg-error/10 text-error" },
  pending: { label: "Oczekuje", color: "bg-muted/10 text-muted" },
};

export default function AnalysisDetailPage() {
  const params = useParams();
  const router = useRouter();
  const folderId = params.id as string;
  const analysisId = params.analysisId as string;

  const [analysis, setAnalysis] = useState<(FolderAnalysis & { conversations?: { ordinal: number; role: string; content: string; cost_usd?: number }[]; sygnatura_map?: Record<string, number> }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  // Follow-up conversation state
  const [followUpMessages, setFollowUpMessages] = useState<FollowUpMessage[]>([]);
  const [followUpStreaming, setFollowUpStreaming] = useState(false);
  const [followUpStreamContent, setFollowUpStreamContent] = useState("");
  const followUpAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/folders/${folderId}/analyses/${analysisId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setAnalysis(data);
        if (data.conversations && data.conversations.length > 0) {
          setFollowUpMessages(
            data.conversations.map((c: { role: string; content: string; cost_usd?: number }) => ({
              role: c.role as "user" | "assistant",
              content: c.content,
              cost_usd: c.cost_usd ? Number(c.cost_usd) : undefined,
            }))
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Nie znaleziono analizy.");
      } finally {
        setLoading(false);
      }
    })();
  }, [folderId, analysisId]);

  const executeFollowUp = useCallback(async (message: string) => {
    followUpAbortRef.current?.abort();
    const abort = new AbortController();
    followUpAbortRef.current = abort;

    setFollowUpMessages(prev => [...prev, { role: "user", content: message }]);
    setFollowUpStreaming(true);
    setFollowUpStreamContent("");

    try {
      const response = await fetch(`/api/folders/${folderId}/analyses/${analysisId}/chat`, {
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
                setFollowUpMessages(prev => [
                  ...prev,
                  { role: "assistant", content: parsed.content || fullContent, cost_usd: parsed.cost_usd || 0 },
                ]);
              } else if (currentEvent === "error") {
                setFollowUpMessages(prev => [
                  ...prev,
                  { role: "assistant", content: "", error: true },
                ]);
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      setFollowUpMessages(prev => [
        ...prev,
        { role: "assistant", content: "", error: true },
      ]);
      console.error("Analysis follow-up error:", err);
    } finally {
      if (!abort.signal.aborted) {
        setFollowUpStreaming(false);
        setFollowUpStreamContent("");
      }
    }
  }, [folderId, analysisId]);

  useEffect(() => {
    return () => { followUpAbortRef.current?.abort(); };
  }, []);

  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/folders/${folderId}/analyses/${analysisId}`, { method: "DELETE" });
      if (res.ok) router.push(`/folders/${folderId}`);
    } catch { /* silent */ }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="rounded-lg border border-error/30 bg-error/5 p-4 text-sm text-error">
          {error || "Nie znaleziono analizy."}
        </div>
        <Link href={`/folders/${folderId}?tab=analizy`} className="text-sm text-accent hover:underline mt-4 inline-block">
          ← Wróć do teczki
        </Link>
      </div>
    );
  }

  const status = statusLabels[analysis.status] || statusLabels.pending;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link href={`/folders/${folderId}?tab=analizy`} className="text-sm text-accent hover:underline">
          ← Wróć do teczki
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-primary">{analysis.title}</h1>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${status.color}`}>
              {status.label}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted">
            <span>{new Date(analysis.created_at).toLocaleDateString("pl-PL")}</span>
            <span>{analysis.verdict_ids.length} orzeczeń</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-3 py-1.5 text-xs text-error hover:bg-error/5 border border-error/30 rounded transition-colors cursor-pointer"
          >
            Usuń
          </button>
        </div>
      </div>

      {/* Metadata — right-aligned above questions, matches search results layout */}
      {analysis.completed_at && analysis.created_at && (
        <div className="mb-4 flex justify-end">
          <SearchMetadata metadata={{
            time_ms: new Date(analysis.completed_at).getTime() - new Date(analysis.created_at).getTime(),
            tokens_used: analysis.tokens_used || 0,
            cost_usd: analysis.cost_usd ? Number(analysis.cost_usd) : 0,
            costs: [{
              layer: "folder_analysis",
              model: analysis.model || "",
              input_tokens: 0,
              output_tokens: 0,
              cost_usd: analysis.cost_usd ? Number(analysis.cost_usd) : 0,
              latency_ms: new Date(analysis.completed_at).getTime() - new Date(analysis.created_at).getTime(),
            }],
          }} />
        </div>
      )}

      {/* Questions */}
      <div className="rounded-lg border border-border bg-card p-4 mb-6">
        <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Pytania analityczne</h3>
        <ul className="space-y-1">
          {analysis.questions.map((q, i) => (
            <li key={i} className="text-sm text-foreground">
              {analysis.questions.length > 1 && <span className="text-muted mr-1">{i + 1}.</span>}
              {q}
            </li>
          ))}
        </ul>
      </div>

      {/* Error */}
      {analysis.error_message && (
        <div className="rounded-lg border border-error/30 bg-error/5 p-4 text-sm text-error mb-6">
          {analysis.error_message}
        </div>
      )}

      {/* Result */}
      {analysis.result && (
        <div className="rounded-lg border border-accent/30 bg-card p-4 mb-6">
          {/* Header row — matches AIOverview */}
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-block h-2 w-2 rounded-full bg-accent flex-shrink-0" />
            <span className="text-xs font-medium text-accent uppercase tracking-wide">
              Analiza AI
            </span>
            <div className="ml-auto">
              <button
                onClick={async () => {
                  if (!resultRef.current) return;
                  try {
                    const html = resultRef.current.innerHTML;
                    const plain = resultRef.current.innerText;
                    await navigator.clipboard.write([
                      new ClipboardItem({
                        "text/html": new Blob([html], { type: "text/html" }),
                        "text/plain": new Blob([plain], { type: "text/plain" }),
                      }),
                    ]);
                  } catch {
                    if (resultRef.current) {
                      await navigator.clipboard.writeText(resultRef.current.innerText);
                    }
                  }
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 transition-colors cursor-pointer"
              >
                {copied ? "Skopiowano!" : "Kopiuj"}
              </button>
            </div>
          </div>
          <div className="ai-overview text-sm leading-relaxed" ref={resultRef}>
            <AnalysisMarkdown content={analysis.result} sygnaturaMap={analysis.sygnatura_map} />
          </div>
        </div>
      )}

      {/* Follow-up conversation */}
      {analysis.result && analysis.status === "completed" && (
        <div className="mb-6">
          <FollowUpChat
            messages={followUpMessages}
            streaming={followUpStreaming}
            streamContent={followUpStreamContent}
            onSend={executeFollowUp}
            sygnaturaMap={analysis.sygnatura_map || {}}
            disabled={false}
            onRetry={executeFollowUp}
          />
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg shadow-lg p-6 w-full max-w-sm mx-4">
            <h2 className="text-sm font-semibold text-primary mb-2">Usuń analizę</h2>
            <p className="text-xs text-muted mb-4">
              Czy na pewno chcesz usunąć analizę &ldquo;{analysis.title}&rdquo;?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 text-xs text-muted hover:text-primary transition-colors cursor-pointer"
              >
                Anuluj
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 text-xs bg-error text-white rounded hover:bg-error/90 transition-colors cursor-pointer"
              >
                Usuń
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
