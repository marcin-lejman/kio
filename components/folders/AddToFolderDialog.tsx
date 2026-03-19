"use client";

import { useState, useEffect } from "react";
import type { Folder } from "./types";

type AddMode =
  | { type: "verdicts"; verdictIds: number[]; addedFrom?: string; note?: string }
  | { type: "search"; searchId: number; query: string };

export function AddToFolderDialog({
  isOpen,
  onClose,
  mode,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  mode: AddMode;
  onAdded?: () => void;
}) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Quick create state
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [creatingLoading, setCreatingLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    setSelectedId(null);
    setCreating(false);
    setNewName("");

    fetch("/api/folders")
      .then((res) => res.json())
      .then((data) => {
        setFolders(data.folders || []);
        setLoading(false);
      })
      .catch(() => {
        setError("Nie udało się załadować teczek.");
        setLoading(false);
      });
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreateFolder = async () => {
    if (!newName.trim()) return;
    setCreatingLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFolders((prev) => [{ ...data, role: "owner" }, ...prev]);
      setSelectedId(data.id);
      setCreating(false);
      setNewName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd tworzenia teczki.");
    } finally {
      setCreatingLoading(false);
    }
  };

  const handleAdd = async () => {
    if (selectedId === null) return;
    setSaving(true);
    setError(null);

    try {
      if (mode.type === "verdicts") {
        const res = await fetch(`/api/folders/${selectedId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            verdict_ids: mode.verdictIds,
            added_from: mode.addedFrom || null,
            note: mode.note || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const addedCount = data.added.length;
        const skippedCount = data.skipped.length;
        let msg = `Dodano ${addedCount} ${addedCount === 1 ? "orzeczenie" : "orzeczeń"}`;
        if (skippedCount > 0) {
          msg += ` (${skippedCount} już w teczce)`;
        }
        setSuccess(msg);
      } else {
        const res = await fetch(`/api/folders/${selectedId}/searches`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ search_id: mode.searchId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        setSuccess("Zapisano wyszukiwanie w teczce");
      }

      onAdded?.();
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd zapisu.");
    } finally {
      setSaving(false);
    }
  };

  const isSearch = mode.type === "search";
  const selectedFolder = folders.find((f) => f.id === selectedId);

  const title = isSearch ? "Zapisz wyszukiwanie do teczki" : "Dodaj do teczki";
  const subtitle = isSearch
    ? `Zapytanie: "${mode.query}"`
    : mode.type === "verdicts" && mode.verdictIds.length === 1
      ? "Wybierz teczkę dla tego orzeczenia"
      : `Wybierz teczkę dla ${mode.type === "verdicts" ? mode.verdictIds.length : 0} orzeczeń`;
  const buttonLabel = isSearch
    ? (selectedFolder ? `Zapisz w "${selectedFolder.name}"` : "Zapisz w teczce")
    : (selectedFolder ? `Dodaj do "${selectedFolder.name}"` : "Dodaj do teczki");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg shadow-lg p-6 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-primary mb-1">{title}</h2>
        <p className="text-xs text-muted mb-4 line-clamp-2">{subtitle}</p>

        {error && (
          <div className="rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error mb-3">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-lg border border-success/20 bg-success/10 p-3 text-xs text-success font-medium mb-3">
            {success}
          </div>
        )}

        {!success && (
          <>
            {/* Folder list */}
            {loading ? (
              <div className="flex justify-center py-6">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              </div>
            ) : (
              <div className="max-h-[40vh] overflow-y-auto space-y-1 mb-4">
                {folders.length === 0 && !creating && (
                  <p className="text-xs text-muted py-4 text-center">
                    Nie masz jeszcze żadnych teczek.
                  </p>
                )}

                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => setSelectedId(folder.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      selectedId === folder.id
                        ? "bg-accent/10 border border-accent/30 text-foreground"
                        : "hover:bg-accent/5 border border-transparent text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{folder.name}</span>
                      {folder.role && folder.role !== "owner" && (
                        <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                          Udostępnione
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted">
                      {folder.item_count} {folder.item_count === 1 ? "orzeczenie" : "orzeczeń"}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Quick create */}
            <div className="border-t border-border pt-3 mb-4">
              {creating ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
                    placeholder="Nazwa nowej teczki"
                    className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    onClick={handleCreateFolder}
                    disabled={!newName.trim() || creatingLoading}
                    className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {creatingLoading ? "..." : "Utwórz"}
                  </button>
                  <button
                    onClick={() => { setCreating(false); setNewName(""); }}
                    className="px-2 py-1.5 text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
                  >
                    Anuluj
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="text-xs text-accent hover:underline cursor-pointer"
                >
                  + Utwórz nową teczkę
                </button>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-muted hover:text-primary transition-colors cursor-pointer"
              >
                Anuluj
              </button>
              <button
                onClick={handleAdd}
                disabled={selectedId === null || saving}
                className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {saving ? "Zapisuję..." : buttonLabel}
              </button>
            </div>
          </>
        )}

        {success && (
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/90 transition-colors cursor-pointer"
            >
              Zamknij
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
