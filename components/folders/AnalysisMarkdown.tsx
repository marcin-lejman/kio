"use client";

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import Link from "next/link";

/**
 * Inject clickable sygnatura links into text.
 * Replicates the pattern from AIOverview.tsx.
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

    const ref = match[1];
    const normalized = ref.replace(/\s+/g, " ").trim();
    const verdictId = sygnaturaMap[normalized] || sygnaturaMap[ref];

    if (verdictId) {
      parts.push(
        <Link
          key={`${match.index}-${ref}`}
          href={`/verdict/${verdictId}`}
          className="inline-flex items-center rounded bg-accent/10 text-accent px-1.5 py-0.5 text-xs font-medium hover:bg-accent/20 transition-colors mx-0.5"
        >
          {normalized}
        </Link>
      );
    } else {
      parts.push(match[0]);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

function processChildren(
  children: React.ReactNode,
  sygnaturaMap: Record<string, number>
): React.ReactNode {
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

function useAnalysisMarkdownComponents(sygnaturaMap: Record<string, number>): Components {
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

export function AnalysisMarkdown({
  content,
  sygnaturaMap = {},
}: {
  content: string;
  sygnaturaMap?: Record<string, number>;
}) {
  const components = useAnalysisMarkdownComponents(sygnaturaMap);
  return (
    <div className="prose prose-sm max-w-none text-sm leading-relaxed">
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  );
}
