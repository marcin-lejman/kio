"use client";

import { useEffect, useState, useCallback } from "react";
import { FolderCard } from "@/components/folders/FolderCard";
import type { Folder } from "@/components/folders/types";

export default function FoldersPage() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchFolders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/folders${showArchived ? "?archived=true" : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFolders(data.folders || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd ładowania teczek.");
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFolders((prev) => [{ ...data, role: "owner" }, ...prev]);
      setNewName("");
      setNewDesc("");
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd tworzenia teczki.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-primary">Teczki projektowe</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className={`text-xs px-2.5 py-1 rounded transition-colors ${
              showArchived
                ? "bg-accent/10 text-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            {showArchived ? "Ukryj zarchiwizowane" : "Pokaż zarchiwizowane"}
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/90 transition-colors cursor-pointer"
          >
            Nowa teczka
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-lg border border-accent/30 bg-card p-4 mb-6">
          <h2 className="text-sm font-semibold text-primary mb-3">Nowa teczka</h2>
          <div className="space-y-3">
            <input
              type="text"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="Nazwa teczki"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Opis (opcjonalny)"
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent resize-y"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowCreate(false); setNewName(""); setNewDesc(""); }}
                className="px-3 py-1.5 text-xs text-muted hover:text-primary transition-colors cursor-pointer"
              >
                Anuluj
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {creating ? "Tworzę..." : "Utwórz teczkę"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-error/30 bg-error/5 p-4 text-sm text-error mb-4">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      )}

      {/* Folder grid */}
      {!loading && folders.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {folders.map((folder) => (
            <FolderCard key={folder.id} folder={folder} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && folders.length === 0 && (
        <div className="text-center py-16">
          <svg className="w-12 h-12 mx-auto text-muted/40 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
          <p className="text-sm text-muted">
            {showArchived
              ? "Brak zarchiwizowanych teczek."
              : "Nie masz jeszcze żadnych teczek."}
          </p>
          {!showArchived && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 text-sm text-accent hover:underline cursor-pointer"
            >
              Utwórz pierwszą teczkę
            </button>
          )}
        </div>
      )}
    </div>
  );
}
