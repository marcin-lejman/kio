"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { AnalysisMarkdown } from "./AnalysisMarkdown";
import type { FolderItem } from "./types";

const decisionLabel: Record<string, string> = {
  oddalone: "Oddalone",
  uwzglednione: "Uwzględnione",
  umorzone: "Umorzone",
  odrzucone: "Odrzucone",
};

const decisionColor: Record<string, string> = {
  oddalone: "bg-red-50 text-red-700",
  uwzglednione: "bg-green-50 text-green-700",
  umorzone: "bg-gray-50 text-gray-600",
  odrzucone: "bg-orange-50 text-orange-700",
};

interface UserTemplate {
  id: number;
  name: string;
  questions: string[];
}

type Step = "select" | "questions" | "streaming";

export function CreateAnalysisFlow({
  folderId,
  items,
  onClose,
  onComplete,
}: {
  folderId: string;
  items: FolderItem[];
  onClose: () => void;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<Step>("select");

  // Step 1: verdict selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Step 2: questions
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<string[]>([""]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [includeNotes, setIncludeNotes] = useState(true);

  // Templates (all stored in DB, seeded with defaults on first use)
  const [templates, setTemplates] = useState<UserTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [loadedTemplateId, setLoadedTemplateId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/analysis-templates")
      .then((res) => res.ok ? res.json() : { templates: [] })
      .then((data) => setTemplates(data.templates || []))
      .catch(() => {})
      .finally(() => setTemplatesLoaded(true));
  }, []);

  // Step 3: streaming
  const [streamText, setStreamText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamDone, setStreamDone] = useState(false);
  const [metadata, setMetadata] = useState<{ tokens_used: number; cost_usd: number; latency_ms: number } | null>(null);
  const [sygnaturaMap, setSygnaturaMap] = useState<Record<string, number>>({});
  const abortRef = useRef<AbortController | null>(null);

  // Step 1 handlers
  const toggleVerdict = (vid: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(vid)) next.delete(vid);
      else if (next.size < 15) next.add(vid);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(items.slice(0, 15).map((i) => i.verdict_id)));
  };

  const selectNone = () => setSelectedIds(new Set());

  // Step 2 handlers
  const applyTemplate = (tmpl: UserTemplate) => {
    setSelectedTemplate(String(tmpl.id));
    setLoadedTemplateId(tmpl.id);
    setTitle(tmpl.name);
    setQuestions([...tmpl.questions]);
  };

  const handleSaveAsTemplate = async () => {
    const validQuestions = questions.filter((q) => q.trim());
    if (!title.trim() || validQuestions.length === 0) return;
    setSavingTemplate(true);
    try {
      const res = await fetch("/api/analysis-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: title.trim(), questions: validQuestions }),
      });
      const data = await res.json();
      if (res.ok) {
        setTemplates((prev) => [data, ...prev]);
        setLoadedTemplateId(data.id);
        setSelectedTemplate(String(data.id));
      }
    } catch { /* silent */ }
    finally { setSavingTemplate(false); }
  };

  const handleUpdateTemplate = async (templateId: number) => {
    const validQuestions = questions.filter((q) => q.trim());
    if (!title.trim() || validQuestions.length === 0) return;
    setSavingTemplate(true);
    try {
      const res = await fetch(`/api/analysis-templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: title.trim(), questions: validQuestions }),
      });
      if (res.ok) {
        setTemplates((prev) => prev.map((t) =>
          t.id === templateId ? { ...t, name: title.trim(), questions: validQuestions } : t
        ));
      }
    } catch { /* silent */ }
    finally { setSavingTemplate(false); }
  };

  const handleDeleteTemplate = async (templateId: number) => {
    try {
      const res = await fetch(`/api/analysis-templates/${templateId}`, { method: "DELETE" });
      if (res.ok) {
        setTemplates((prev) => prev.filter((t) => t.id !== templateId));
        if (loadedTemplateId === templateId) {
          setLoadedTemplateId(null);
          setSelectedTemplate(null);
        }
      }
    } catch { /* silent */ }
  };

  const addQuestion = () => setQuestions((prev) => [...prev, ""]);
  const removeQuestion = (idx: number) => setQuestions((prev) => prev.filter((_, i) => i !== idx));
  const updateQuestion = (idx: number, val: string) =>
    setQuestions((prev) => prev.map((q, i) => (i === idx ? val : q)));

  // Step 3: start analysis
  const startAnalysis = useCallback(async () => {
    setStep("streaming");
    setStreaming(true);
    setStreamText("");
    setStreamError(null);
    setStreamDone(false);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/folders/${folderId}/analyses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          questions: questions.filter((q) => q.trim()),
          template: selectedTemplate,
          verdict_ids: Array.from(selectedIds),
          include_notes: includeNotes,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Błąd serwera");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (currentEvent === "token") {
                setStreamText((prev) => prev + data);
              } else if (currentEvent === "done") {
                setMetadata(data.metadata);
                if (data.sygnatura_map) setSygnaturaMap(data.sygnatura_map);
                setStreamDone(true);
                setStreaming(false);
              } else if (currentEvent === "error") {
                setStreamError(data.message);
                setStreaming(false);
              }
            } catch {
              // skip
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setStreamError(err instanceof Error ? err.message : "Błąd połączenia.");
      }
      setStreaming(false);
    }
  }, [folderId, title, questions, selectedTemplate, selectedIds, includeNotes]);

  const handleCancel = () => {
    if (streaming && abortRef.current) {
      abortRef.current.abort();
    }
    onClose();
  };

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className={step === "select" ? "text-accent font-medium" : ""}>
          1. Wybierz orzeczenia
        </span>
        <span>→</span>
        <span className={step === "questions" ? "text-accent font-medium" : ""}>
          2. Pytania
        </span>
        <span>→</span>
        <span className={step === "streaming" ? "text-accent font-medium" : ""}>
          3. Analiza
        </span>
        <button
          onClick={handleCancel}
          className="ml-auto text-xs text-muted hover:text-foreground cursor-pointer"
        >
          Anuluj
        </button>
      </div>

      {/* Step 1: Select verdicts */}
      {step === "select" && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-foreground">
              Wybierz orzeczenia do analizy ({selectedIds.size}/15)
            </p>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-xs text-accent hover:underline cursor-pointer">
                Zaznacz wszystkie
              </button>
              <button onClick={selectNone} className="text-xs text-muted hover:text-foreground cursor-pointer">
                Odznacz
              </button>
            </div>
          </div>

          <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
            {items.map((item) => (
              <label
                key={item.id}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                  selectedIds.has(item.verdict_id)
                    ? "border-accent/30 bg-accent/5"
                    : "border-border hover:bg-accent/5"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.verdict_id)}
                  onChange={() => toggleVerdict(item.verdict_id)}
                  disabled={!selectedIds.has(item.verdict_id) && selectedIds.size >= 15}
                  className="mt-0.5 accent-accent"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-primary">{item.sygnatura}</span>
                    {item.verdict_date && (
                      <span className="text-xs text-muted">{item.verdict_date}</span>
                    )}
                    {item.decision_type_normalized && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        decisionColor[item.decision_type_normalized] || "bg-gray-50 text-gray-600"
                      }`}>
                        {decisionLabel[item.decision_type_normalized] || item.decision_type_normalized}
                      </span>
                    )}
                  </div>
                  {item.summary && (
                    <p className="text-xs text-muted mt-0.5">{item.summary}</p>
                  )}
                </div>
              </label>
            ))}
          </div>

          <div className="flex justify-end mt-4">
            <button
              onClick={() => setStep("questions")}
              disabled={selectedIds.size === 0}
              className="px-4 py-2 text-sm bg-accent text-white rounded-md hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Dalej →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Questions */}
      {step === "questions" && (
        <div className="space-y-5">
          {/* Saved templates */}
          {templatesLoaded && templates.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Szablony</p>
              <div className="flex flex-wrap gap-2">
                {templates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => applyTemplate(tmpl)}
                    className={`group relative inline-flex items-center gap-1.5 rounded-full pl-3 pr-7 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                      loadedTemplateId === tmpl.id
                        ? "bg-accent text-white"
                        : "bg-card border border-border text-foreground hover:border-accent/30 hover:bg-accent/5"
                    }`}
                  >
                    {tmpl.name}
                    <span
                      onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(tmpl.id); }}
                      className={`absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${
                        loadedTemplateId === tmpl.id ? "text-white/60 hover:text-white" : "text-muted/40 hover:text-error"
                      }`}
                      title="Usuń"
                    >
                      ×
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!templatesLoaded && (
            <div className="flex justify-center py-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
          )}

          {/* Title + Questions form */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted">Tytuł analizy</label>
                {(title || questions.some((q) => q.trim())) && (
                  <button
                    onClick={() => { setTitle(""); setQuestions([""]); setLoadedTemplateId(null); setSelectedTemplate(null); }}
                    className="text-[11px] text-muted hover:text-foreground transition-colors cursor-pointer"
                  >
                    Wyczyść
                  </button>
                )}
              </div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="np. Analiza linii orzeczniczej w sprawie..."
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label className="text-xs text-muted mb-1 block">Pytania analityczne</label>
              <div className="space-y-2">
                {questions.map((q, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="text"
                      value={q}
                      onChange={(e) => updateQuestion(i, e.target.value)}
                      placeholder={`Pytanie ${i + 1}`}
                      className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    {questions.length > 1 && (
                      <button
                        onClick={() => removeQuestion(i)}
                        className="text-muted hover:text-error transition-colors cursor-pointer px-1"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {questions.length < 10 && (
                <button
                  onClick={addQuestion}
                  className="mt-2 text-xs text-accent hover:underline cursor-pointer"
                >
                  + Dodaj pytanie
                </button>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={includeNotes}
                onChange={(e) => setIncludeNotes(e.target.checked)}
                className="accent-accent"
              />
              Uwzględnij notatki użytkowników jako kontekst dla AI
            </label>

            {/* Template save actions */}
            {title.trim() && questions.some((q) => q.trim()) && (
              <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                {loadedTemplateId && (
                  <button
                    onClick={() => handleUpdateTemplate(loadedTemplateId)}
                    disabled={savingTemplate}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted hover:text-foreground hover:border-accent/30 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Zaktualizuj szablon
                  </button>
                )}
                <button
                  onClick={handleSaveAsTemplate}
                  disabled={savingTemplate}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted hover:text-foreground hover:border-accent/30 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Zapisz jako nowy szablon
                </button>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex justify-between">
            <button
              onClick={() => setStep("select")}
              className="text-sm text-muted hover:text-foreground transition-colors cursor-pointer"
            >
              ← Wstecz
            </button>
            <button
              onClick={startAnalysis}
              disabled={!title.trim() || questions.filter((q) => q.trim()).length === 0}
              className="px-4 py-2 text-sm bg-accent text-white rounded-md hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Rozpocznij analizę
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Streaming result */}
      {step === "streaming" && (
        <div>
          <div className="rounded-lg border border-accent/30 bg-card p-4">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
              {streaming && (
                <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse" />
              )}
              {streamDone && (
                <span className="inline-block h-2 w-2 rounded-full bg-success" />
              )}
              {streamError && (
                <span className="inline-block h-2 w-2 rounded-full bg-error" />
              )}
              <span className="text-xs font-medium text-accent uppercase tracking-wide">
                {streaming ? "Generuję analizę..." : streamDone ? "Analiza zakończona" : "Błąd"}
              </span>
              {metadata && (
                <span className="ml-auto text-[11px] text-muted">
                  {metadata.tokens_used.toLocaleString()} tokenów · ${metadata.cost_usd.toFixed(4)} · {(metadata.latency_ms / 1000).toFixed(1)}s
                </span>
              )}
            </div>

            {/* Content */}
            {streamText ? (
              <AnalysisMarkdown content={streamText} sygnaturaMap={sygnaturaMap} />
            ) : streaming ? (
              <span className="text-sm text-muted">Analizuję orzeczenia...</span>
            ) : null}

            {streamError && (
              <div className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-xs text-error">
                {streamError}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end mt-4">
            <button
              onClick={() => { onComplete(); onClose(); }}
              className="px-4 py-2 text-sm bg-accent text-white rounded-md hover:bg-accent/90 transition-colors cursor-pointer"
            >
              {streamDone ? "Zamknij" : streaming ? "Anuluj" : "Zamknij"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
