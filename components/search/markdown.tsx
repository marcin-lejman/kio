"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Components } from "react-markdown";

/**
 * Find every KIO reference in the text and render it as a badge/link.
 * Works on bare refs (KIO 3297/23) and refs inside brackets ([KIO 3297/23]).
 */
export function injectSygnaturaLinks(
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

export function processChildren(children: React.ReactNode, sygnaturaMap: Record<string, number>): React.ReactNode {
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

export function useMarkdownComponents(sygnaturaMap: Record<string, number>): Components {
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
