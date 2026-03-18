"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface SimilarVerdict {
  verdict_id: number;
  sygnatura: string;
  verdict_date: string;
  document_type_normalized: string;
  decision_type_normalized: string;
  score: number;
  best_matching_section: string;
  snippet: string;
}

const decisionLabel: Record<string, string> = {
  oddalone: "Oddalone",
  uwzglednione: "Uwzględnione",
  umorzone: "Umorzone",
  odrzucone: "Odrzucone",
};

const decisionColor: Record<string, string> = {
  oddalone: "bg-red-50 text-red-700 border border-red-200",
  uwzglednione: "bg-green-50 text-green-700 border border-green-200",
  umorzone: "bg-gray-50 text-gray-600 border border-gray-200",
  odrzucone: "bg-orange-50 text-orange-700 border border-orange-200",
};

const sectionLabels: Record<string, string> = {
  sentencja: "Sentencja",
  uzasadnienie_fakty: "Stan faktyczny",
  uzasadnienie_rozważania: "Rozważania Izby",
  uzasadnienie: "Uzasadnienie",
  koszty: "Koszty postępowania",
  header: "Nagłówek",
  content: "Treść",
  full_document: "Pełny dokument",
};

function humanSectionLabel(label: string): string {
  if (label.startsWith("uzasadnienie_zarzut_")) {
    return `Zarzut ${label.replace("uzasadnienie_zarzut_", "")}`;
  }
  if (label.startsWith("uzasadnienie_ad_")) {
    return `Ad. ${label.replace("uzasadnienie_ad_", "")}`;
  }
  return sectionLabels[label] || label;
}

function formatSygnatura(syg: string): string {
  const normalized = syg.replace(/\s*\/\s*/g, "/");
  return normalized.includes("|")
    ? normalized.split("|").map((s) => s.trim()).join(", ")
    : normalized;
}

function SimilarVerdictCard({ verdict }: { verdict: SimilarVerdict }) {
  const scorePercent = Math.round(verdict.score * 100);

  return (
    <Link href={`/verdict/${verdict.verdict_id}`} className="block group">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-accent group-hover:underline truncate">
          {formatSygnatura(verdict.sygnatura)}
        </span>
        <span className="text-[11px] text-muted whitespace-nowrap">
          {verdict.verdict_date}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-0.5">
        {verdict.decision_type_normalized && (
          <span
            className={`inline-block rounded-full px-1.5 py-0 text-[10px] font-medium ${
              decisionColor[verdict.decision_type_normalized] ||
              "bg-gray-50 text-gray-600 border border-gray-200"
            }`}
          >
            {decisionLabel[verdict.decision_type_normalized] ||
              verdict.decision_type_normalized}
          </span>
        )}
        <span className="text-[10px] text-muted">
          {humanSectionLabel(verdict.best_matching_section)}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex-1 h-1 bg-muted/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent/60 rounded-full"
            style={{ width: `${scorePercent}%` }}
          />
        </div>
        <span className="text-[10px] text-muted tabular-nums">
          {scorePercent}%
        </span>
      </div>

      {verdict.snippet && (
        <p className="mt-1 text-[11px] text-muted/70 line-clamp-2 leading-relaxed">
          {verdict.snippet}
        </p>
      )}
    </Link>
  );
}

export function SimilarVerdicts({ verdictId }: { verdictId: number }) {
  const [similar, setSimilar] = useState<SimilarVerdict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!verdictId) return;
    let cancelled = false;

    async function fetchSimilar() {
      try {
        const res = await fetch(`/api/verdict/${verdictId}/similar`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled) setSimilar(data.similar || []);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchSimilar();

    return () => {
      cancelled = true;
    };
  }, [verdictId]);

  if (error) return null;

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold mb-3 text-primary">
          Podobne orzeczenia
        </h2>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-muted/20 rounded w-3/4 mb-1.5" />
              <div className="h-3 bg-muted/10 rounded w-1/2 mb-1" />
              <div className="h-2 bg-muted/10 rounded w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (similar.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold mb-3 text-primary">
        Podobne orzeczenia
      </h2>
      <div className="space-y-3">
        {similar.slice(0, 8).map((v) => (
          <SimilarVerdictCard key={v.verdict_id} verdict={v} />
        ))}
      </div>
    </div>
  );
}
