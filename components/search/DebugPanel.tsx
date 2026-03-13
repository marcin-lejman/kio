"use client";

import { useState } from "react";
import type { DebugData } from "./types";

export function DebugPanel({ debug }: { debug: DebugData }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<string>("query");

  const sections = [
    { id: "query", label: "Query Understanding" },
    { id: "fts", label: `FTS (${debug.fts_results?.length ?? 0})` },
    { id: "vector", label: `Vector (${debug.vector_results?.length ?? 0})` },
    { id: "fused", label: `Fused (${debug.fused_results?.length ?? 0})` },
  ];

  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2 text-left text-xs font-medium text-orange-800 hover:bg-orange-100 transition-colors"
      >
        {open ? "Hide" : "Show"} Debug Output
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex gap-1 border-b border-orange-200 pb-2">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
                  section === s.id
                    ? "bg-orange-200 text-orange-900"
                    : "text-orange-700 hover:bg-orange-100"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {section === "query" && debug.query_understanding && (
            <div>
              <pre className="text-xs bg-white rounded p-2 overflow-x-auto whitespace-pre-wrap border border-orange-200">
{JSON.stringify(debug.query_understanding, null, 2)}
              </pre>
              {debug.fts_query && (
                <div className="mt-2">
                  <h4 className="text-xs font-semibold text-orange-900 mb-1">FTS Query String</h4>
                  <pre className="text-xs bg-white rounded p-2 overflow-x-auto whitespace-pre-wrap border border-orange-200 max-h-32 overflow-y-auto">
{debug.fts_query}
                  </pre>
                </div>
              )}
            </div>
          )}

          {section === "fts" && debug.fts_results && (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {debug.fts_results.map((r, i) => (
                <div key={i} className="text-xs bg-white rounded p-2 border border-orange-200">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-semibold text-orange-900">{r.sygnatura}</span>
                    <span className="font-mono text-orange-700">score: {r.score.toFixed(4)}</span>
                  </div>
                  <span className="text-orange-600">[{r.section_label}]</span>
                  <p className="text-gray-600 mt-1">{r.chunk_text_preview}...</p>
                </div>
              ))}
              {debug.fts_results.length === 0 && (
                <p className="text-xs text-orange-700">No FTS results</p>
              )}
            </div>
          )}

          {section === "vector" && debug.vector_results && (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {debug.vector_results.map((r, i) => (
                <div key={i} className="text-xs bg-white rounded p-2 border border-orange-200">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-semibold text-orange-900">{r.sygnatura}</span>
                    <span className="font-mono text-orange-700">sim: {r.score.toFixed(4)}</span>
                  </div>
                  <span className="text-orange-600">[{r.section_label}]</span>
                  <p className="text-gray-600 mt-1">{r.chunk_text_preview}...</p>
                </div>
              ))}
              {debug.vector_results.length === 0 && (
                <p className="text-xs text-orange-700">No vector results</p>
              )}
            </div>
          )}

          {section === "fused" && debug.fused_results && (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {debug.fused_results.map((r, i) => (
                <div key={i} className="text-xs bg-white rounded p-2 border border-orange-200 flex justify-between items-center">
                  <div>
                    <span className="font-semibold text-orange-900">{r.sygnatura}</span>
                    <span className="text-orange-600 ml-2">[{r.section_label}]</span>
                  </div>
                  <div className="flex gap-3 font-mono text-orange-700">
                    <span>rrf: {r.score.toFixed(6)}</span>
                    <span className={`px-1 rounded ${
                      r.source === "both" ? "bg-green-100 text-green-800" :
                      r.source === "vector" ? "bg-blue-100 text-blue-800" :
                      "bg-yellow-100 text-yellow-800"
                    }`}>{r.source}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
