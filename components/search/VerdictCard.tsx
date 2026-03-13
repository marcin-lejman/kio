"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { VerdictResult } from "./types";

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

const sectionLabels: Record<string, string> = {
  sentencja: "Sentencja",
  uzasadnienie_fakty: "Stan faktyczny",
  uzasadnienie_rozważania: "Rozważania Izby",
  koszty: "Koszty postępowania",
  header: "Nagłówek",
  content: "Treść",
  full_document: "Pełny dokument",
};

function humanSectionLabel(label: string): string {
  // Handle subsection labels like "uzasadnienie_zarzut_1", "uzasadnienie_ad_3"
  if (label.startsWith("uzasadnienie_zarzut_")) {
    const num = label.replace("uzasadnienie_zarzut_", "");
    return `Zarzut ${num}`;
  }
  if (label.startsWith("uzasadnienie_ad_")) {
    const num = label.replace("uzasadnienie_ad_", "");
    return `Ad. ${num}`;
  }
  return sectionLabels[label] || label;
}

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
  return syg.includes("|") ? syg.split("|").map((s) => s.trim()).join(", ") : syg;
}

/**
 * Build a keyword regex from the keywords list.
 * Sorts by length descending so longer phrases match first.
 */
function buildKeywordPattern(keywords: string[]): RegExp | null {
  const sorted = [...keywords]
    .filter((k) => k.length >= 2)
    .sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return null;
  const escaped = sorted.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(${escaped.join("|")})`, "gi");
}

/**
 * Extract a KWIC (Keyword-in-Context) snippet centered around the first
 * keyword match. If no keywords match, falls back to the first N characters.
 */
function extractSnippet(
  text: string,
  pattern: RegExp | null,
  maxLength: number = 280
): string {
  if (!pattern) return text.slice(0, maxLength) + (text.length > maxLength ? "..." : "");

  // Reset regex state
  pattern.lastIndex = 0;
  const firstMatch = pattern.exec(text);

  if (!firstMatch) {
    return text.slice(0, maxLength) + (text.length > maxLength ? "..." : "");
  }

  const matchPos = firstMatch.index;

  // Center a window around the match
  const halfWindow = Math.floor(maxLength / 2);
  let start = Math.max(0, matchPos - halfWindow);
  let end = Math.min(text.length, start + maxLength);

  // Adjust start if we hit the end
  if (end === text.length) {
    start = Math.max(0, end - maxLength);
  }

  // Snap to word boundaries
  if (start > 0) {
    const spaceAfter = text.indexOf(" ", start);
    if (spaceAfter !== -1 && spaceAfter < start + 30) {
      start = spaceAfter + 1;
    }
  }
  if (end < text.length) {
    const spaceBefore = text.lastIndexOf(" ", end);
    if (spaceBefore > end - 30) {
      end = spaceBefore;
    }
  }

  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return prefix + text.slice(start, end) + suffix;
}

/**
 * Highlight keyword matches in text. Returns React nodes with matches
 * wrapped in <mark>.
 */
function highlightKeywords(
  text: string,
  pattern: RegExp | null
): React.ReactNode[] {
  if (!pattern) return [text];

  pattern.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <mark
        key={match.index}
        className="bg-yellow-200/70 text-foreground rounded-sm"
      >
        {match[0]}
      </mark>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

export function VerdictCard({
  verdict,
  keywords,
}: {
  verdict: VerdictResult;
  keywords?: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const topPassage = verdict.matching_passages[0];
  const pattern = useMemo(() => buildKeywordPattern(keywords || []), [keywords]);

  const topSnippet = useMemo(
    () => topPassage ? extractSnippet(topPassage.chunk_text, pattern, 280) : "",
    [topPassage, pattern]
  );

  return (
    <div className="rounded-lg border border-border bg-card p-4 hover:border-accent/30 transition-colors group">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Header row */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <Link
              href={`/verdict/${verdict.verdict_id}`}
              className="text-base font-semibold text-accent hover:underline"
            >
              {formatSygnatura(verdict.sygnatura)}
            </Link>
            <span className="text-xs text-muted">
              {formatPolishDate(verdict.verdict_date)}
            </span>
          </div>

          {/* Metadata badges */}
          <div className="flex items-center gap-2 mt-1">
            {verdict.decision_type_normalized && (
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  decisionColor[verdict.decision_type_normalized] ||
                  "bg-gray-50 text-gray-600 border border-gray-200"
                }`}
              >
                {decisionLabel[verdict.decision_type_normalized] ||
                  verdict.decision_type}
              </span>
            )}
            <span className="text-[11px] text-muted capitalize">
              {verdict.document_type_normalized}
            </span>
          </div>

          {/* Top passage snippet */}
          {topPassage && (
            <div className="mt-2.5 border-l-2 border-accent/20 pl-3">
              <span className="text-[11px] font-medium text-accent/70 uppercase tracking-wide">
                {humanSectionLabel(topPassage.section_label)}
              </span>
              <p className="mt-0.5 text-sm text-foreground/70 leading-relaxed line-clamp-3">
                {highlightKeywords(topSnippet, pattern)}
              </p>
            </div>
          )}

          {/* Expanded passages */}
          {expanded && verdict.matching_passages.length > 1 && (
            <div className="mt-3 space-y-2.5 border-t border-border pt-3">
              {verdict.matching_passages.slice(1).map((p, i) => (
                <div key={i} className="border-l-2 border-border pl-3">
                  <span className="text-[11px] font-medium text-muted uppercase tracking-wide">
                    {humanSectionLabel(p.section_label)}
                  </span>
                  <p className="mt-0.5 text-sm text-foreground/70 leading-relaxed line-clamp-2">
                    {highlightKeywords(
                      extractSnippet(p.chunk_text, pattern, 200),
                      pattern
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}

          {verdict.matching_passages.length > 1 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-2 text-xs text-accent hover:underline"
            >
              {expanded
                ? "Zwiń"
                : `+${verdict.matching_passages.length - 1} więcej fragmentów`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
