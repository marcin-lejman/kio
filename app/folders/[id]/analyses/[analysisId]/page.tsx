"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AnalysisMarkdown } from "@/components/folders/AnalysisMarkdown";
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

  const [analysis, setAnalysis] = useState<FolderAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/folders/${folderId}/analyses/${analysisId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setAnalysis(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Nie znaleziono analizy.");
      } finally {
        setLoading(false);
      }
    })();
  }, [folderId, analysisId]);

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
            {analysis.tokens_used && (
              <span>{analysis.tokens_used.toLocaleString()} tokenów</span>
            )}
            {analysis.cost_usd && (
              <span>${analysis.cost_usd.toFixed(4)}</span>
            )}
            {analysis.completed_at && analysis.created_at && (
              <span>
                {((new Date(analysis.completed_at).getTime() - new Date(analysis.created_at).getTime()) / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {analysis.result && (
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
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  // Fallback to plain text
                  const plain = resultRef.current.innerText;
                  await navigator.clipboard.writeText(plain);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }
              }}
              className="px-3 py-1.5 text-xs border border-border rounded hover:border-accent/30 hover:text-accent transition-colors cursor-pointer"
            >
              {copied ? "Skopiowano!" : "Kopiuj"}
            </button>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-3 py-1.5 text-xs text-error hover:bg-error/5 border border-error/30 rounded transition-colors cursor-pointer"
          >
            Usuń
          </button>
        </div>
      </div>

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
        <div className="rounded-lg border border-accent/20 bg-card p-6" ref={resultRef}>
          <AnalysisMarkdown content={analysis.result} />
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
