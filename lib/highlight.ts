import React from "react";

/**
 * Build a keyword regex from the keywords list.
 * Sorts by length descending so longer phrases match first.
 */
export function buildKeywordPattern(keywords: string[]): RegExp | null {
  const sorted = [...keywords]
    .filter((k) => k.length >= 2)
    .sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return null;
  const escaped = sorted.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(${escaped.join("|")})`, "gi");
}

/**
 * Highlight keyword matches in text. Returns React nodes with matches
 * wrapped in <mark>.
 */
export function highlightKeywords(
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
      React.createElement(
        "mark",
        {
          key: match.index,
          className: "bg-yellow-200/70 text-foreground rounded-sm",
        },
        match[0]
      )
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
