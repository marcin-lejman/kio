"use client";

import { useEffect, useState } from "react";

interface PartialDetail {
  verdict_id: number;
  actual: number;
  expected: number;
  sygnatura: string;
}

interface DatabaseHealth {
  total_verdicts: number;
  total_chunks: number;
  chunks_without_embeddings: number;
  verdicts_without_chunks: number;
  verdicts_with_partial_chunks: number;
  partial_details: PartialDetail[];
  duplicate_chunk_groups: number;
  avg_chunks_per_verdict: number;
  tier_breakdown: { tier: string; count: number }[];
  type_breakdown: { type: string; count: number }[];
  oldest_verdict: string;
  newest_verdict: string;
}

export default function UstawieniaPage() {
  const [health, setHealth] = useState<DatabaseHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchHealth() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/database-health");
      if (!response.ok) throw new Error("Błąd pobierania danych");
      const data = await response.json();
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nieznany błąd");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchHealth();
  }, []);

  const issues =
    health &&
    health.verdicts_without_chunks +
      health.chunks_without_embeddings +
      health.verdicts_with_partial_chunks +
      health.duplicate_chunk_groups;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-semibold text-primary">Ustawienia</h1>
      </div>

      {/* Jakość bazy section */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-primary">
              Jakość bazy
            </h2>
            {!loading && health && (
              <span
                className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                  issues === 0
                    ? "bg-green-100 text-green-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {issues === 0 ? "OK" : `${issues} ${issues === 1 ? "problem" : "problemów"}`}
              </span>
            )}
          </div>
          <button
            onClick={fetchHealth}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded border border-border text-muted hover:border-accent/30 hover:text-foreground transition-colors disabled:opacity-50"
          >
            {loading ? "Ładowanie..." : "Odśwież"}
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && health && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              <StatCard
                label="Orzeczenia"
                value={health.total_verdicts.toLocaleString()}
              />
              <StatCard
                label="Chunki"
                value={health.total_chunks.toLocaleString()}
                detail={`śr. ${health.avg_chunks_per_verdict}/orzeczenie`}
              />
              <StatCard
                label="Zakres dat"
                value={formatDateRange(health.oldest_verdict, health.newest_verdict)}
                small
              />
              <StatCard
                label="Śr. chunków/orzeczenie"
                value={String(health.avg_chunks_per_verdict)}
              />
            </div>

            {/* Issues */}
            <div className="mb-8">
              <h3 className="text-sm font-semibold text-primary mb-3">
                Problemy
              </h3>
              <div className="space-y-2">
                <IssueRow
                  label="Orzeczenia bez chunków"
                  count={health.verdicts_without_chunks}
                  description="Orzeczenia zapisane w bazie, ale bez podzielonych fragmentów tekstu"
                />
                <IssueRow
                  label="Chunki bez embeddingów"
                  count={health.chunks_without_embeddings}
                  description="Fragmenty tekstu bez wektora — niewidoczne w wyszukiwaniu semantycznym"
                />
                <IssueRow
                  label="Orzeczenia z niekompletnymi chunkami"
                  count={health.verdicts_with_partial_chunks}
                  description="Liczba chunków w bazie mniejsza niż oczekiwana"
                />
                <IssueRow
                  label="Zduplikowane chunki"
                  count={health.duplicate_chunk_groups}
                  description="Ten sam fragment (verdict_id + chunk_position) występuje więcej niż raz"
                />
              </div>
            </div>

            {/* Partial details */}
            {health.partial_details.length > 0 && (
              <div className="mb-8">
                <h3 className="text-sm font-semibold text-primary mb-3">
                  Niekompletne orzeczenia
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 font-medium text-muted">Sygnatura</th>
                        <th className="text-right py-2 px-3 font-medium text-muted">Chunki w bazie</th>
                        <th className="text-right py-2 px-3 font-medium text-muted">Oczekiwane</th>
                        <th className="text-right py-2 px-3 font-medium text-muted">Brakujące</th>
                      </tr>
                    </thead>
                    <tbody>
                      {health.partial_details.slice(0, 20).map((d) => (
                        <tr key={d.verdict_id} className="border-b border-border/50">
                          <td className="py-2 px-3 font-mono text-xs">{d.sygnatura}</td>
                          <td className="py-2 px-3 text-right text-muted">{d.actual}</td>
                          <td className="py-2 px-3 text-right text-muted">{d.expected}</td>
                          <td className="py-2 px-3 text-right text-red-600 font-medium">
                            {d.expected - d.actual}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {health.partial_details.length > 20 && (
                    <p className="text-xs text-muted mt-2 px-3">
                      ...i {health.partial_details.length - 20} więcej
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Breakdowns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
              {/* Tier breakdown */}
              <div>
                <h3 className="text-sm font-semibold text-primary mb-3">
                  Podział wg tier
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 font-medium text-muted">Tier</th>
                        <th className="text-right py-2 px-3 font-medium text-muted">Liczba</th>
                        <th className="text-right py-2 px-3 font-medium text-muted">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {health.tier_breakdown.map((t) => (
                        <tr key={t.tier} className="border-b border-border/50">
                          <td className="py-2 px-3 font-mono text-xs">{t.tier || "(brak)"}</td>
                          <td className="py-2 px-3 text-right text-muted">
                            {t.count.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 text-right text-muted">
                            {((t.count / health.total_verdicts) * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Type breakdown */}
              <div>
                <h3 className="text-sm font-semibold text-primary mb-3">
                  Podział wg typu
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 font-medium text-muted">Typ</th>
                        <th className="text-right py-2 px-3 font-medium text-muted">Liczba</th>
                        <th className="text-right py-2 px-3 font-medium text-muted">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {health.type_breakdown.map((t) => (
                        <tr key={t.type} className="border-b border-border/50">
                          <td className="py-2 px-3">{t.type || "(brak)"}</td>
                          <td className="py-2 px-3 text-right text-muted">
                            {t.count.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 text-right text-muted">
                            {((t.count / health.total_verdicts) * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  small,
}: {
  label: string;
  value: string;
  detail?: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
      <p
        className={`font-semibold text-primary mt-1 ${
          small ? "text-base" : "text-2xl"
        }`}
      >
        {value}
      </p>
      {detail && <p className="text-xs text-muted mt-1">{detail}</p>}
    </div>
  );
}

function IssueRow({
  label,
  count,
  description,
}: {
  label: string;
  count: number;
  description: string;
}) {
  const ok = count === 0;
  return (
    <div
      className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
        ok
          ? "border-green-200 bg-green-50/50"
          : "border-amber-200 bg-amber-50/50"
      }`}
    >
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted">{description}</p>
      </div>
      <span
        className={`text-lg font-semibold tabular-nums ${
          ok ? "text-green-600" : "text-amber-600"
        }`}
      >
        {count.toLocaleString()}
      </span>
    </div>
  );
}

function formatDateRange(oldest: string, newest: string): string {
  if (!oldest || !newest) return "—";
  const fmt = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString("pl-PL", {
      month: "short",
      year: "numeric",
    });
  };
  return `${fmt(oldest)} – ${fmt(newest)}`;
}
