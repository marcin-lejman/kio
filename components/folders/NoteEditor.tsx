"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";

export function NoteEditor({
  onSave,
  placeholder = "Dodaj notatkę...",
  loading = false,
}: {
  onSave: (content: string) => void;
  placeholder?: string;
  loading?: boolean;
}) {
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(false);

  const handleSave = () => {
    if (!content.trim()) return;
    onSave(content.trim());
    setContent("");
    setPreview(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPreview(false)}
          className={`text-xs px-2 py-1 rounded ${
            !preview ? "bg-accent/10 text-accent font-medium" : "text-muted hover:text-foreground"
          }`}
        >
          Edycja
        </button>
        <button
          onClick={() => setPreview(true)}
          className={`text-xs px-2 py-1 rounded ${
            preview ? "bg-accent/10 text-accent font-medium" : "text-muted hover:text-foreground"
          }`}
        >
          Podgląd
        </button>
      </div>

      {preview ? (
        <div className="rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[80px] prose prose-sm max-w-none">
          {content.trim() ? (
            <ReactMarkdown>{content}</ReactMarkdown>
          ) : (
            <span className="text-muted italic">Brak treści do wyświetlenia</span>
          )}
        </div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent resize-y"
        />
      )}

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={!content.trim() || loading}
          className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {loading ? "Zapisuję..." : "Zapisz notatkę"}
        </button>
      </div>
    </div>
  );
}
