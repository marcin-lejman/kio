"use client";

import { useState } from "react";
import type { SearchMetadataType } from "./types";

export function SearchMetadata({ metadata }: { metadata: SearchMetadataType }) {
  const [expanded, setExpanded] = useState(false);

  const hasCost = metadata.cost_usd > 0;

  return (
    <div className="text-xs text-muted flex flex-col items-end">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 hover:text-foreground/70 transition-colors"
      >
        <span>{(metadata.time_ms / 1000).toFixed(1)}s</span>
        <svg
          className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {expanded && (
        <div className="mt-1 flex flex-col gap-0.5 items-end">
          <div className="flex items-center gap-2">
            <span>{metadata.tokens_used.toLocaleString()} tokenów</span>
            {hasCost && <span>{metadata.cost_usd.toFixed(4).replace(".", ",")} USD</span>}
          </div>
          {metadata.costs.length > 0 && (
            <div className="flex items-center gap-2 font-mono flex-wrap justify-end">
              {metadata.costs.map((c, i) => (
                <span key={i} title={c.model}>
                  {c.layer.replace("_", " ")}: {(c.latency_ms / 1000).toFixed(1)}s
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
