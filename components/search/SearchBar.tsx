"use client";

import { useState } from "react";
import type { SearchFilters } from "./types";
import { ANSWER_MODELS } from "./types";

export function SearchBar({
  onSearch,
  loading,
  initialQuery,
  initialFilters,
  initialModel,
}: {
  onSearch: (query: string, filters: SearchFilters, answerModel: string) => void;
  loading: boolean;
  initialQuery?: string;
  initialFilters?: SearchFilters;
  initialModel?: string;
}) {
  const [query, setQuery] = useState(initialQuery || "");
  const [showFilters, setShowFilters] = useState(
    !!(initialFilters?.document_type || initialFilters?.decision_type || initialFilters?.date_from || initialFilters?.date_to)
  );
  const [filters, setFilters] = useState<SearchFilters>(initialFilters || {});
  const [answerModel, setAnswerModel] = useState(initialModel || ANSWER_MODELS[0].id);

  const activeFilterCount = [filters.document_type, filters.decision_type, filters.date_from, filters.date_to].filter(Boolean).length;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) onSearch(query.trim(), filters, answerModel);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative">
        <svg
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Wyszukaj orzeczenia KIO..."
          className="w-full rounded-lg border border-border bg-card pl-11 pr-24 py-3.5 text-base shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-accent disabled:opacity-50 transition-colors"
        >
          {loading ? "Szukam..." : "Szukaj"}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1">
        <span className="text-xs text-muted mr-1">Model:</span>
        {ANSWER_MODELS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setAnswerModel(m.id)}
            className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
              answerModel === m.id
                ? "bg-accent/10 text-foreground font-medium"
                : "text-muted hover:text-foreground"
            }`}
            disabled={loading}
            title={m.hint}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="mt-2">
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
        >
          <svg
            className={`transition-transform duration-200 ${showFilters ? "rotate-90" : ""}`}
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          Filtry
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent leading-none">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ${
          showFilters ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="mt-2 rounded-lg border border-border/60 bg-background p-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <div>
                <label className="block text-[11px] font-medium text-muted mb-1">Typ dokumentu</label>
                <select
                  value={filters.document_type || ""}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      document_type: e.target.value || undefined,
                    }))
                  }
                  className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">Wszystkie</option>
                  <option value="wyrok">Wyrok</option>
                  <option value="postanowienie">Postanowienie</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted mb-1">Rozstrzygnięcie</label>
                <select
                  value={filters.decision_type || ""}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      decision_type: e.target.value || undefined,
                    }))
                  }
                  className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">Wszystkie</option>
                  <option value="oddalone">Oddalone</option>
                  <option value="uwzglednione">Uwzględnione</option>
                  <option value="umorzone">Umorzone</option>
                  <option value="odrzucone">Odrzucone</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted mb-1">Od</label>
                <input
                  type="date"
                  value={filters.date_from || ""}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, date_from: e.target.value || undefined }))
                  }
                  className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted mb-1">Do</label>
                <input
                  type="date"
                  value={filters.date_to || ""}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, date_to: e.target.value || undefined }))
                  }
                  className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
