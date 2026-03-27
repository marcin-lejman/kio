"use client";

import { useEffect, useState } from "react";

interface DailyCost {
  day: string;
  model: string;
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
}

interface CostSummary {
  total_cost_usd: number;
  total_calls: number;
  period_days: number;
}

export default function AdminPage() {
  const [daily, setDaily] = useState<DailyCost[]>([]);
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    async function fetchCosts() {
      setLoading(true);
      try {
        const response = await fetch(`/api/costs?days=${days}`);
        const data = await response.json();
        setDaily(data.daily || []);
        setSummary(data.summary);
      } catch (err) {
        console.error("Failed to fetch costs:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchCosts();
  }, [days]);

  // Group by day for the summary table
  const dailyTotals = daily.reduce<
    Record<string, { calls: number; cost: number; tokens: number }>
  >((acc, row) => {
    const d = row.day;
    if (!acc[d]) acc[d] = { calls: 0, cost: 0, tokens: 0 };
    acc[d].calls += row.total_calls;
    acc[d].cost += parseFloat(String(row.total_cost));
    acc[d].tokens += row.total_input_tokens + row.total_output_tokens;
    return acc;
  }, {});

  // Group by model for model breakdown
  const modelTotals = daily.reduce<
    Record<string, { calls: number; cost: number; input_tokens: number; output_tokens: number }>
  >((acc, row) => {
    const m = row.model;
    if (!acc[m]) acc[m] = { calls: 0, cost: 0, input_tokens: 0, output_tokens: 0 };
    acc[m].calls += row.total_calls;
    acc[m].cost += parseFloat(String(row.total_cost));
    acc[m].input_tokens += row.total_input_tokens;
    acc[m].output_tokens += row.total_output_tokens;
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-primary">
          Panel kosztów API
        </h1>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 text-sm rounded border transition-colors ${
                days === d
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted hover:border-accent/30"
              }`}
            >
              {d} dni
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      )}

      {!loading && (
        <>
          {/* Summary cards */}
          {summary && (
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs text-muted uppercase tracking-wide">
                  Łączny koszt
                </p>
                <p className="text-2xl font-semibold text-primary mt-1">
                  {summary.total_cost_usd.toFixed(2).replace(".", ",")} USD
                </p>
                <p className="text-xs text-muted mt-1">
                  ostatnie {summary.period_days} dni
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs text-muted uppercase tracking-wide">
                  Wywołania API
                </p>
                <p className="text-2xl font-semibold text-primary mt-1">
                  {summary.total_calls.toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs text-muted uppercase tracking-wide">
                  Śr. koszt/wywołanie
                </p>
                <p className="text-2xl font-semibold text-primary mt-1">
                  $
                  {summary.total_calls > 0
                    ? (summary.total_cost_usd / summary.total_calls).toFixed(4)
                    : "0.00"}
                </p>
              </div>
            </div>
          )}

          {/* Model breakdown */}
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-primary mb-3">
              Podział wg modelu
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-medium text-muted">Model</th>
                    <th className="text-right py-2 px-3 font-medium text-muted">Wywołania</th>
                    <th className="text-right py-2 px-3 font-medium text-muted">Input tokens</th>
                    <th className="text-right py-2 px-3 font-medium text-muted">Output tokens</th>
                    <th className="text-right py-2 px-3 font-medium text-muted">Koszt</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(modelTotals)
                    .sort((a, b) => b[1].cost - a[1].cost)
                    .map(([model, data]) => (
                      <tr
                        key={model}
                        className="border-b border-border/50"
                      >
                        <td className="py-2 px-3 font-mono text-xs">{model}</td>
                        <td className="py-2 px-3 text-right text-muted">
                          {data.calls.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right text-muted font-mono text-xs">
                          {data.input_tokens.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right text-muted font-mono text-xs">
                          {data.output_tokens.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-xs">
                          {data.cost.toFixed(4).replace(".", ",")} USD
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Daily breakdown */}
          <div>
            <h2 className="text-sm font-semibold text-primary mb-3">
              Dzienny przegląd
            </h2>
            {Object.keys(dailyTotals).length === 0 ? (
              <p className="text-muted text-sm">Brak danych za wybrany okres.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 font-medium text-muted">Data</th>
                      <th className="text-right py-2 px-3 font-medium text-muted">Wywołania</th>
                      <th className="text-right py-2 px-3 font-medium text-muted">Tokeny</th>
                      <th className="text-right py-2 px-3 font-medium text-muted">Koszt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(dailyTotals)
                      .sort((a, b) => b[0].localeCompare(a[0]))
                      .map(([day, data]) => (
                        <tr
                          key={day}
                          className="border-b border-border/50"
                        >
                          <td className="py-2 px-3">{day}</td>
                          <td className="py-2 px-3 text-right text-muted">
                            {data.calls.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 text-right text-muted font-mono text-xs">
                            {data.tokens.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-xs">
                            {data.cost.toFixed(4).replace(".", ",")} USD
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
