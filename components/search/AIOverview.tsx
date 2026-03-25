"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";

/**
 * Find every KIO reference in the text and render it as a badge/link.
 * Works on bare refs (KIO 3297/23) and refs inside brackets ([KIO 3297/23]).
 */
function injectSygnaturaLinks(
  text: string,
  sygnaturaMap: Record<string, number>
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const pattern = /\[?\s*(KIO\s+\d+\/\d+)\s*\]?/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const ref = match[1].replace(/\s+/g, " ").trim();
    const normalizedRef = ref.replace(/\s*\/\s*/g, "/");
    const verdictId = sygnaturaMap[ref] ?? sygnaturaMap[normalizedRef];

    if (verdictId != null) {
      parts.push(
        <Link
          key={match.index}
          href={`/verdict/${verdictId}`}
          className="inline-block rounded bg-accent/10 border border-accent/20 px-1.5 py-0.5 text-xs font-semibold text-accent hover:bg-accent/20 hover:border-accent/40 transition-colors no-underline"
        >
          {ref}
        </Link>
      );
    } else {
      parts.push(
        <span key={match.index} className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs text-muted">
          {ref}
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function processChildren(children: React.ReactNode, sygnaturaMap: Record<string, number>): React.ReactNode {
  if (!children) return children;
  if (typeof children === "string") {
    return injectSygnaturaLinks(children, sygnaturaMap);
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string") {
        return <span key={i}>{injectSygnaturaLinks(child, sygnaturaMap)}</span>;
      }
      return child;
    });
  }
  return children;
}

function useMarkdownComponents(sygnaturaMap: Record<string, number>): Components {
  return useMemo((): Components => ({
    p: ({ children }) => <p className="mb-3 last:mb-0">{processChildren(children, sygnaturaMap)}</p>,
    li: ({ children }) => <li className="mb-1">{processChildren(children, sygnaturaMap)}</li>,
    strong: ({ children }) => <strong className="font-semibold">{processChildren(children, sygnaturaMap)}</strong>,
    em: ({ children }) => <em>{processChildren(children, sygnaturaMap)}</em>,
    ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
    h1: ({ children }) => <h3 className="font-semibold text-base mb-2 mt-4 first:mt-0">{processChildren(children, sygnaturaMap)}</h3>,
    h2: ({ children }) => <h3 className="font-semibold text-base mb-2 mt-4 first:mt-0">{processChildren(children, sygnaturaMap)}</h3>,
    h3: ({ children }) => <h4 className="font-semibold text-sm mb-2 mt-3 first:mt-0">{processChildren(children, sygnaturaMap)}</h4>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-accent/40 pl-3 my-2 text-muted italic">{children}</blockquote>
    ),
  }), [sygnaturaMap]);
}

function WaitingIndicator() {
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="text-muted">
      Analizuję {elapsed > 0 ? `${elapsed}` : ""}
      <span className="inline-flex w-6 overflow-hidden align-baseline">
        <span className="animate-ellipsis">...</span>
      </span>
    </span>
  );
}

/**
 * Build the dropdown options: 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100.
 * If totalResults is smaller than a step, cap at totalResults as the last option.
 */
function buildVerdictCountOptions(totalResults: number): number[] {
  const steps = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100];
  const options: number[] = [];
  for (const step of steps) {
    if (step >= totalResults) {
      if (options.length === 0 || options[options.length - 1] !== totalResults) {
        options.push(totalResults);
      }
      break;
    }
    options.push(step);
  }
  if (options.length === 0) options.push(totalResults);
  return options;
}

export function AIOverview({
  overview,
  streaming,
  error,
  sygnaturaMap,
  unresolvedRefs,
  onSaveToFolder,
  totalResults,
  answerModel,
  onRegenerate,
  regenerating,
}: {
  overview: string;
  streaming: boolean;
  error: boolean;
  sygnaturaMap: Record<string, number>;
  unresolvedRefs?: string[];
  onSaveToFolder?: () => void;
  totalResults?: number;
  answerModel?: string;
  onRegenerate?: (verdictCount: number) => void;
  regenerating?: boolean;
}) {
  const components = useMarkdownComponents(sygnaturaMap);
  const overviewRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [selectedCount, setSelectedCount] = useState(15);

  const options = useMemo(
    () => buildVerdictCountOptions(totalResults || 15),
    [totalResults]
  );

  // Estimate cost for the selected model + count
  const costEstimate = useMemo(() => {
    if (selectedCount <= 15 || !answerModel) return null;
    // ~7000 tokens per verdict envelope (matched chunks + sentencja + fakty + rozważania) + 2000 base
    const inputTokens = 2_000 + selectedCount * 7_000;
    const outputTokens = Math.min(Math.max(8_000, selectedCount * 500), 32_000);
    // Use inline cost table to avoid importing server-side module
    const rates: Record<string, { input: number; output: number }> = {
      "google/gemini-3.1-flash-lite-preview": { input: 0.02, output: 0.08 },
      "google/gemini-3.1-pro-preview": { input: 1.25, output: 10.0 },
      "anthropic/claude-sonnet-4.6": { input: 3.0, output: 15.0 },
      "openai/gpt-5.4": { input: 2.5, output: 10.0 },
    };
    const r = rates[answerModel] || { input: 1, output: 3 };
    const cost = (inputTokens * r.input + outputTokens * r.output) / 1_000_000;
    return cost;
  }, [selectedCount, answerModel]);

  const handleCopy = async () => {
    if (!overviewRef.current) return;
    try {
      const html = overviewRef.current.innerHTML;
      const plain = overviewRef.current.innerText;
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(overviewRef.current.innerText);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (error) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
        <p className="text-sm text-warning">
          Nie udało się wygenerować podsumowania AI. Wyniki wyszukiwania poniżej.
        </p>
      </div>
    );
  }

  if (!overview && !streaming && !regenerating) return null;

  const isRegenerateAvailable = selectedCount > 15 && onRegenerate && !streaming && !regenerating;

  return (
    <div className="rounded-lg border border-accent/30 bg-card p-4">
      {/* Header row */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span
          className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${
            streaming || regenerating ? "bg-accent animate-pulse" : "bg-accent"
          }`}
        />
        <span className="text-xs font-medium text-accent uppercase tracking-wide">
          Podsumowanie AI na podstawie pierwszych
        </span>
        {/* Verdict count dropdown */}
        <select
          value={selectedCount}
          onChange={(e) => setSelectedCount(Number(e.target.value))}
          disabled={streaming || regenerating}
          className="rounded border border-accent/30 bg-accent/5 px-1.5 py-0.5 text-xs font-semibold text-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
        >
          {options.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <span className="text-xs font-medium text-accent uppercase tracking-wide">
          wyników
          {(streaming || regenerating) && " ..."}
        </span>

        {/* Action buttons */}
        {!streaming && !regenerating && overview && (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 transition-colors cursor-pointer"
            >
              {copied ? "Skopiowano!" : "Kopiuj"}
            </button>
            {onSaveToFolder && (
              <button
                onClick={onSaveToFolder}
                className="flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 transition-colors cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10.5v6m3-3H9m4.06-7.19l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
                Zapisz do teczki
              </button>
            )}
          </div>
        )}
      </div>

      {/* Regenerate bar — shown when user selects more than default 15 */}
      {isRegenerateAvailable && (
        <div className="mb-3 flex items-center gap-3 rounded border border-accent/20 bg-accent/5 px-3 py-2">
          <button
            onClick={() => onRegenerate(selectedCount)}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-accent transition-colors"
          >
            Regeneruj podsumowanie
          </button>
          {costEstimate !== null && (
            <span className="text-[11px] text-muted">
              Szacowany koszt: ~${costEstimate < 0.01 ? "<0.01" : costEstimate.toFixed(2)} USD
              {" "}(~{Math.round((2_000 + selectedCount * 7_000) / 1000)}K tokenów wejściowych)
            </span>
          )}
        </div>
      )}

      {/* Content */}
      <div className="relative">
        <div className={`ai-overview text-sm leading-relaxed transition-opacity duration-300 ${regenerating && overview ? "opacity-30" : ""}`} ref={overviewRef}>
          {overview ? (
            <ReactMarkdown components={components}>{overview}</ReactMarkdown>
          ) : (streaming || regenerating) ? (
            <WaitingIndicator />
          ) : null}
          {streaming && overview && (
            <span className="inline-block w-1.5 h-4 bg-accent/60 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>
        {regenerating && overview && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-lg bg-card/90 border border-accent/20 px-4 py-2 shadow-sm">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span className="text-sm text-accent font-medium">Regeneruję podsumowanie...</span>
            </div>
          </div>
        )}
      </div>
      {unresolvedRefs && unresolvedRefs.length > 0 && !streaming && !regenerating && (
        <div className="mt-3 rounded border border-orange-200 bg-orange-50 px-3 py-2">
          <p className="text-xs text-orange-800">
            AI wygenerowało odniesienia do sygnatur, których nie ma w wynikach wyszukiwania:{" "}
            {unresolvedRefs.join(", ")}
          </p>
        </div>
      )}
    </div>
  );
}
