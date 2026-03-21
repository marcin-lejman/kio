"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface HistoryEntry {
  id: number;
  query: string;
  result_count: number;
  ai_status: string;
  answer_model: string | null;
  tokens_used: number;
  cost_usd: number;
  latency_ms: number;
  created_at: string;
  user_email: string | null;
}

const modelLabels: Record<string, string> = {
  "anthropic/claude-sonnet-4.6": "Claude Sonnet",
  "google/gemini-3.1-flash-lite-preview": "Gemini Flash",
  "google/gemini-3.1-pro-preview": "Gemini Pro",
  "openai/gpt-5.4": "GPT-5.4",
};

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  useEffect(() => {
    async function fetchHistory() {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/history?limit=${pageSize}&offset=${page * pageSize}`
        );
        const data = await response.json();
        setHistory(data.history);
        setTotal(data.total);
      } catch (err) {
        console.error("Failed to fetch history:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, [page]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-xl font-semibold text-primary mb-6">
        Historia wyszukiwań
      </h1>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      )}

      {!loading && history.length === 0 && (
        <div className="text-center py-16">
          <p className="text-muted">Brak historii wyszukiwań.</p>
          <Link href="/" className="text-accent hover:underline text-sm mt-2 inline-block">
            Rozpocznij wyszukiwanie
          </Link>
        </div>
      )}

      {!loading && history.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 font-medium text-muted">Data</th>
                  <th className="text-left py-2 px-3 font-medium text-muted">Zapytanie</th>
                  <th className="text-right py-2 px-3 font-medium text-muted">Wyniki</th>
                  <th className="text-right py-2 px-3 font-medium text-muted">Model</th>
                  <th className="text-right py-2 px-3 font-medium text-muted">Tokeny</th>
                  <th className="text-right py-2 px-3 font-medium text-muted">Koszt</th>
                  <th className="text-right py-2 px-3 font-medium text-muted">Czas</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-border/50 hover:bg-accent/5 transition-colors"
                  >
                    <td
                      className="py-2 px-3 text-muted whitespace-nowrap"
                      title={entry.user_email || undefined}
                    >
                      {new Date(entry.created_at).toLocaleDateString("pl-PL", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-2 px-3 max-w-md">
                      <Link
                        href={`/search/${entry.id}`}
                        className="text-accent hover:underline truncate block"
                      >
                        {entry.query}
                      </Link>
                    </td>
                    <td className="py-2 px-3 text-right text-muted">
                      {entry.result_count}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {entry.ai_status === "error" ? (
                        <span className="inline-block rounded-full px-2 py-0.5 text-xs bg-red-100 text-red-800">
                          Błąd
                        </span>
                      ) : entry.answer_model ? (
                        <span className="text-xs text-muted">
                          {modelLabels[entry.answer_model] || entry.answer_model}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right text-muted font-mono text-xs">
                      {entry.tokens_used?.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right text-muted font-mono text-xs">
                      ${entry.cost_usd?.toFixed(4)}
                    </td>
                    <td className="py-2 px-3 text-right text-muted font-mono text-xs">
                      {(entry.latency_ms / 1000).toFixed(1)}s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-muted">
                {total} wyszukiwań łącznie
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 text-sm rounded border border-border hover:bg-accent/5 disabled:opacity-50"
                >
                  Poprzednia
                </button>
                <span className="px-3 py-1 text-sm text-muted">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 text-sm rounded border border-border hover:bg-accent/5 disabled:opacity-50"
                >
                  Następna
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
