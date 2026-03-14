"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

const decisionLabel: Record<string, string> = {
  oddalone: "Oddalone",
  uwzglednione: "Uwzględnione",
  umorzone: "Umorzone",
  odrzucone: "Odrzucone",
  inne: "Inne",
};

const decisionColor: Record<string, string> = {
  oddalone: "bg-red-50 text-red-700 border border-red-200",
  uwzglednione: "bg-green-50 text-green-700 border border-green-200",
  umorzone: "bg-gray-50 text-gray-600 border border-gray-200",
  odrzucone: "bg-orange-50 text-orange-700 border border-orange-200",
};

function formatPolishDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("pl-PL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatSygnatura(syg: string): string {
  return syg.includes("|")
    ? syg
        .split("|")
        .map((s) => s.trim())
        .join(", ")
    : syg;
}

interface BrowseVerdict {
  id: string;
  sygnatura: string;
  verdict_date: string;
  document_type: string;
  document_type_normalized: string;
  decision_type: string;
  decision_type_normalized: string;
  metadata_json: {
    chairman?: string;
    contracting_authority?: string;
    [key: string]: unknown;
  } | null;
}

interface BrowseResponse {
  verdicts: BrowseVerdict[];
  total: number;
  page: number;
  per_page: number;
}

export default function BrowsePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-2xl font-bold text-foreground mb-6">
            Przeglądaj orzeczenia
          </h1>
          <div className="space-y-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-card p-4 animate-pulse"
              >
                <div className="h-4 bg-muted/20 rounded w-1/3 mb-2" />
                <div className="h-3 bg-muted/20 rounded w-2/3" />
              </div>
            ))}
          </div>
        </div>
      }
    >
      <BrowseContent />
    </Suspense>
  );
}

function BrowseContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read initial state from URL params
  const [sygnatura, setSygnatura] = useState(
    searchParams.get("sygnatura") || ""
  );
  const [documentType, setDocumentType] = useState(
    searchParams.get("document_type") || ""
  );
  const [decisionType, setDecisionType] = useState(
    searchParams.get("decision_type") || ""
  );
  const [dateFrom, setDateFrom] = useState(
    searchParams.get("date_from") || ""
  );
  const [dateTo, setDateTo] = useState(searchParams.get("date_to") || "");
  const [chairman, setChairman] = useState(
    searchParams.get("chairman") || ""
  );
  const [contractingAuthority, setContractingAuthority] = useState(
    searchParams.get("contracting_authority") || ""
  );
  const [page, setPage] = useState(
    parseInt(searchParams.get("page") || "1", 10) || 1
  );

  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildQueryString = useCallback(
    (overrides: Record<string, string | number> = {}) => {
      const p: Record<string, string> = {};
      const vals: Record<string, string | number> = {
        sygnatura,
        document_type: documentType,
        decision_type: decisionType,
        date_from: dateFrom,
        date_to: dateTo,
        chairman,
        contracting_authority: contractingAuthority,
        page,
        ...overrides,
      };
      for (const [k, v] of Object.entries(vals)) {
        const s = String(v).trim();
        if (s && s !== "1" && k === "page") p[k] = s;
        else if (s && k !== "page") p[k] = s;
      }
      return new URLSearchParams(p).toString();
    },
    [
      sygnatura,
      documentType,
      decisionType,
      dateFrom,
      dateTo,
      chairman,
      contractingAuthority,
      page,
    ]
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = buildQueryString();
    try {
      const res = await fetch(`/api/browse?${qs}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json: BrowseResponse = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, [buildQueryString]);

  // Sync URL when filters change
  useEffect(() => {
    const qs = buildQueryString();
    const currentQs = searchParams.toString();
    if (qs !== currentQs) {
      router.replace(`/browse${qs ? `?${qs}` : ""}`, { scroll: false });
    }
  }, [buildQueryString, router, searchParams]);

  // Fetch on mount and when filters/page change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Debounced text inputs reset page to 1
  const handleTextFilter = useCallback(
    (setter: (v: string) => void, value: string) => {
      setter(value);
      setPage(1);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // fetchData will be triggered by state change
    },
    []
  );

  const totalPages = data ? Math.ceil(data.total / data.per_page) : 0;

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent";
  const selectClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent";

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-foreground mb-6">
        Przeglądaj orzeczenia
      </h1>

      {/* Filters */}
      <div className="rounded-lg border border-border bg-card p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Sygnatura (KIO)
            </label>
            <input
              type="text"
              placeholder="np. KIO 1234/24"
              className={inputClass}
              value={sygnatura}
              onChange={(e) =>
                handleTextFilter(setSygnatura, e.target.value)
              }
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Typ dokumentu
            </label>
            <select
              className={selectClass}
              value={documentType}
              onChange={(e) => {
                setDocumentType(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Wszystkie</option>
              <option value="wyrok">Wyrok</option>
              <option value="postanowienie">Postanowienie</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Typ decyzji
            </label>
            <select
              className={selectClass}
              value={decisionType}
              onChange={(e) => {
                setDecisionType(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Wszystkie</option>
              <option value="oddalone">Oddalone</option>
              <option value="uwzglednione">Uwzględnione</option>
              <option value="umorzone">Umorzone</option>
              <option value="odrzucone">Odrzucone</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Przewodniczący
            </label>
            <input
              type="text"
              placeholder="Nazwisko"
              className={inputClass}
              value={chairman}
              onChange={(e) =>
                handleTextFilter(setChairman, e.target.value)
              }
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Data od
            </label>
            <input
              type="date"
              className={inputClass}
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Data do
            </label>
            <input
              type="date"
              className={inputClass}
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-muted mb-1">
              Zamawiający
            </label>
            <input
              type="text"
              placeholder="Nazwa zamawiającego"
              className={inputClass}
              value={contractingAuthority}
              onChange={(e) =>
                handleTextFilter(setContractingAuthority, e.target.value)
              }
            />
          </div>
        </div>
      </div>

      {/* Result count */}
      {data && !loading && (
        <p className="text-sm text-muted mb-4">
          Znaleziono{" "}
          <span className="font-semibold text-foreground">
            {data.total.toLocaleString("pl-PL")}
          </span>{" "}
          orzeczeń
        </p>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-card p-4 animate-pulse"
            >
              <div className="h-4 bg-muted/20 rounded w-1/3 mb-2" />
              <div className="h-3 bg-muted/20 rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      {!loading && data && data.verdicts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted uppercase tracking-wide">
                <th className="pb-2 pr-4 font-medium">Sygnatura</th>
                <th className="pb-2 pr-4 font-medium">Data</th>
                <th className="pb-2 pr-4 font-medium">Typ</th>
                <th className="pb-2 pr-4 font-medium">Decyzja</th>
                <th className="pb-2 pr-4 font-medium">Przewodniczący</th>
                <th className="pb-2 font-medium">Zamawiający</th>
              </tr>
            </thead>
            <tbody>
              {data.verdicts.map((v) => (
                <tr
                  key={v.id}
                  className="border-b border-border/50 hover:bg-accent/5 transition-colors"
                >
                  <td className="py-2.5 pr-4">
                    <Link
                      href={`/verdict/${v.id}`}
                      className="font-medium text-accent hover:underline whitespace-nowrap"
                    >
                      {formatSygnatura(v.sygnatura)}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4 text-muted whitespace-nowrap">
                    {formatPolishDate(v.verdict_date)}
                  </td>
                  <td className="py-2.5 pr-4 text-muted capitalize whitespace-nowrap">
                    {v.document_type_normalized}
                  </td>
                  <td className="py-2.5 pr-4">
                    {v.decision_type_normalized && (
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                          decisionColor[v.decision_type_normalized] ||
                          "bg-gray-50 text-gray-600 border border-gray-200"
                        }`}
                      >
                        {decisionLabel[v.decision_type_normalized] ||
                          v.decision_type}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-muted">
                    {v.metadata_json?.chairman || "—"}
                  </td>
                  <td className="py-2.5 text-muted max-w-xs truncate">
                    {v.metadata_json?.contracting_authority || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {!loading && data && data.verdicts.length === 0 && (
        <div className="text-center py-12 text-muted">
          <p className="text-lg font-medium">Brak wyników</p>
          <p className="text-sm mt-1">
            Spróbuj zmienić kryteria wyszukiwania
          </p>
        </div>
      )}

      {/* Pagination */}
      {!loading && data && totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-4 py-2 text-sm rounded-md border border-border bg-card hover:bg-accent/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Poprzednia
          </button>
          <span className="text-sm text-muted">
            Strona{" "}
            <span className="font-medium text-foreground">{page}</span> z{" "}
            <span className="font-medium text-foreground">{totalPages}</span>
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-4 py-2 text-sm rounded-md border border-border bg-card hover:bg-accent/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Następna
          </button>
        </div>
      )}
    </div>
  );
}
