"use client";

import { useState } from "react";
import Link from "next/link";
import type { FolderAnalysis } from "./types";

const statusLabels: Record<string, { label: string; color: string }> = {
  completed: { label: "Zakończona", color: "bg-success/10 text-success" },
  running: { label: "W trakcie", color: "bg-accent/10 text-accent" },
  error: { label: "Błąd", color: "bg-error/10 text-error" },
  pending: { label: "Oczekuje", color: "bg-muted/10 text-muted" },
};

export function AnalysisCard({
  analysis,
  folderId,
  onDelete,
}: {
  analysis: FolderAnalysis;
  folderId: string;
  onDelete?: (id: number) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const status = statusLabels[analysis.status] || statusLabels.pending;

  return (
    <>
      <div className="rounded-lg border border-border bg-card hover:border-accent/30 transition-colors group">
        <Link
          href={`/folders/${folderId}/analyses/${analysis.id}`}
          className="block p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-primary truncate group-hover:text-accent transition-colors">
                  {analysis.title}
                </h4>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${status.color}`}>
                  {status.label}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                <span>{new Date(analysis.created_at).toLocaleDateString("pl-PL")}</span>
                <span>{analysis.verdict_ids.length} orzeczeń</span>
                {analysis.cost_usd != null && analysis.cost_usd > 0 && (
                  <span>${analysis.cost_usd.toFixed(4)}</span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                {analysis.questions.map((q, i) => (
                  <span key={i}>
                    {i > 0 && " · "}
                    {q.length > 60 ? q.slice(0, 60) + "..." : q}
                  </span>
                ))}
              </p>
              {analysis.result && (
                <p className="mt-1.5 text-xs text-foreground/60 line-clamp-2">
                  {analysis.result.replace(/[#*_\[\]]/g, "").slice(0, 200)}
                </p>
              )}
            </div>
          </div>
        </Link>

        {onDelete && (
          <div className="border-t border-border/50 px-4 py-2 flex justify-end">
            <button
              onClick={(e) => { e.preventDefault(); setConfirmDelete(true); }}
              className="text-xs text-muted hover:text-error transition-colors cursor-pointer"
            >
              Usuń
            </button>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg shadow-lg p-6 w-full max-w-sm mx-4">
            <h2 className="text-sm font-semibold text-primary mb-2">Usuń analizę</h2>
            <p className="text-xs text-muted mb-4">
              Czy na pewno chcesz usunąć analizę &ldquo;{analysis.title}&rdquo;?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 text-xs text-muted hover:text-primary transition-colors cursor-pointer"
              >
                Anuluj
              </button>
              <button
                onClick={() => { onDelete?.(analysis.id); setConfirmDelete(false); }}
                className="px-3 py-1.5 text-xs bg-error text-white rounded hover:bg-error/90 transition-colors cursor-pointer"
              >
                Usuń
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
