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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) onSearch(query.trim(), filters, answerModel);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Wyszukaj orzeczenia KIO..."
            className="w-full rounded-lg border border-border bg-card px-4 py-3 pr-24 text-base shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
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
        <select
          value={answerModel}
          onChange={(e) => setAnswerModel(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-3 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          disabled={loading}
        >
          {ANSWER_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="text-xs text-muted hover:text-foreground transition-colors"
        >
          {showFilters ? "Ukryj filtry" : "Filtry"}
        </button>
      </div>

      {showFilters && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <select
            value={filters.document_type || ""}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                document_type: e.target.value || undefined,
              }))
            }
            className="rounded border border-border bg-card px-2 py-1.5 text-sm"
          >
            <option value="">Typ dokumentu</option>
            <option value="wyrok">Wyrok</option>
            <option value="postanowienie">Postanowienie</option>
          </select>
          <select
            value={filters.decision_type || ""}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                decision_type: e.target.value || undefined,
              }))
            }
            className="rounded border border-border bg-card px-2 py-1.5 text-sm"
          >
            <option value="">Rozstrzygnięcie</option>
            <option value="oddalone">Oddalone</option>
            <option value="uwzglednione">Uwzględnione</option>
            <option value="umorzone">Umorzone</option>
            <option value="odrzucone">Odrzucone</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Od
            <input
              type="date"
              value={filters.date_from || ""}
              onChange={(e) =>
                setFilters((f) => ({ ...f, date_from: e.target.value || undefined }))
              }
              className="rounded border border-border bg-card px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Do
            <input
              type="date"
              value={filters.date_to || ""}
              onChange={(e) =>
                setFilters((f) => ({ ...f, date_to: e.target.value || undefined }))
              }
              className="rounded border border-border bg-card px-2 py-1.5 text-sm"
            />
          </label>
        </div>
      )}
    </form>
  );
}
