"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { NoteEditor } from "@/components/folders/NoteEditor";
import { AnalysisCard } from "@/components/folders/AnalysisCard";
import { CreateAnalysisFlow } from "@/components/folders/CreateAnalysisFlow";
import type { Folder, FolderItem, FolderNote, FolderTag, FolderAnalysis, FolderSavedSearch } from "@/components/folders/types";

const decisionLabel: Record<string, string> = {
  oddalone: "Oddalone",
  uwzglednione: "Uwzględnione",
  umorzone: "Umorzone",
  odrzucone: "Odrzucone",
  inne: "Inne",
};

const decisionColor: Record<string, string> = {
  oddalone: "bg-red-50 text-red-700 border border-red-200",
  uwzglednione: "bg-green-50 text-green-700 border border-green-200",
  umorzone: "bg-gray-50 text-gray-600 border border-gray-200",
  odrzucone: "bg-orange-50 text-orange-700 border border-orange-200",
};

function pluralNotatki(n: number): string {
  if (n === 1) return "1 notatka";
  const lastTwo = n % 100;
  const lastOne = n % 10;
  if (lastTwo >= 12 && lastTwo <= 14) return `${n} notatek`;
  if (lastOne >= 2 && lastOne <= 4) return `${n} notatki`;
  return `${n} notatek`;
}

function formatPolishDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("pl-PL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

type Tab = "orzeczenia" | "analizy" | "ustawienia";

const TABS: { key: Tab; label: string; phase1: boolean }[] = [
  { key: "orzeczenia", label: "Orzeczenia", phase1: true },
  { key: "analizy", label: "Analizy", phase1: true },
  { key: "ustawienia", label: "Udostępnianie", phase1: true },
];

export default function FolderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderId = params.id as string;
  const initialTab = searchParams.get("tab") as Tab | null;

  const [folder, setFolder] = useState<Folder | null>(null);
  const [items, setItems] = useState<FolderItem[]>([]);
  const [savedSearches, setSavedSearches] = useState<FolderSavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(initialTab && TABS.some((t) => t.key === initialTab && t.phase1) ? initialTab : "orzeczenia");

  // Inline edit
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState("");

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [removeItemConfirm, setRemoveItemConfirm] = useState<FolderItem | null>(null);
  const [removeAllConfirm, setRemoveAllConfirm] = useState(false);

  // Notes per item (expanded items)
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const [itemNotes, setItemNotes] = useState<Map<number, FolderNote[]>>(new Map());
  const [noteSaving, setNoteSaving] = useState(false);
  const [editingNote, setEditingNote] = useState<number | null>(null);
  const [editNoteContent, setEditNoteContent] = useState("");

  // Tags
  const [folderTags, setFolderTags] = useState<FolderTag[]>([]);
  const [showTagCreator, setShowTagCreator] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6b7280");
  const [tagDropdownItem, setTagDropdownItem] = useState<number | null>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  // Drag and drop
  const [dragItemId, setDragItemId] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  // Close tag dropdown on click outside
  useEffect(() => {
    if (tagDropdownItem === null) return;
    const handler = (e: MouseEvent) => {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownItem(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [tagDropdownItem]);

  // Sharing state
  const [shares, setShares] = useState<Array<{ id: number; user_id: string; email: string; permission: string; created_at: string }>>([]);
  const [sharesOwner, setSharesOwner] = useState<{ id: string; email: string } | null>(null);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [sharesLoaded, setSharesLoaded] = useState(false);
  const [platformUsers, setPlatformUsers] = useState<Array<{ id: string; email: string }>>([]);
  const [shareUserId, setShareUserId] = useState("");
  const [sharePermission, setSharePermission] = useState("read");
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareSearch, setShareSearch] = useState("");
  const [shareDropdownOpen, setShareDropdownOpen] = useState(false);
  const shareDropdownRef = useRef<HTMLDivElement>(null);

  // Close share dropdown on click outside
  useEffect(() => {
    if (!shareDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (shareDropdownRef.current && !shareDropdownRef.current.contains(e.target as Node)) {
        setShareDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [shareDropdownOpen]);

  // Analyses
  const [analyses, setAnalyses] = useState<FolderAnalysis[]>([]);
  const [analysesLoaded, setAnalysesLoaded] = useState(false);
  const [analysesLoading, setAnalysesLoading] = useState(false);
  const [showCreateAnalysis, setShowCreateAnalysis] = useState(false);

  const fetchFolder = useCallback(async () => {
    try {
      const res = await fetch(`/api/folders/${folderId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFolder(data);
      setEditName(data.name);
      setEditDesc(data.description || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie znaleziono teczki.");
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  const fetchItems = useCallback(async () => {
    setItemsLoading(true);
    try {
      const [itemsRes, searchesRes, tagsRes] = await Promise.all([
        fetch(`/api/folders/${folderId}/items`),
        fetch(`/api/folders/${folderId}/searches`),
        fetch(`/api/folders/${folderId}/tags`),
      ]);
      const itemsData = await itemsRes.json();
      const searchesData = await searchesRes.json();
      const tagsData = await tagsRes.json();
      if (itemsRes.ok) setItems(itemsData.items || []);
      if (searchesRes.ok) setSavedSearches(searchesData.searches || []);
      if (tagsRes.ok) setFolderTags(tagsData.tags || []);
    } catch {
      // Non-critical — folder detail still shows
    } finally {
      setItemsLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    fetchFolder();
    fetchItems();
    if (initialTab === "analizy") fetchAnalyses();
    if (initialTab === "ustawienia") fetchShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchFolder, fetchItems]);

  const fetchNotes = async (itemId: number) => {
    try {
      const res = await fetch(`/api/folders/${folderId}/items/${itemId}/notes`);
      const data = await res.json();
      if (res.ok) {
        setItemNotes((prev) => new Map(prev).set(itemId, data.notes || []));
      }
    } catch {
      // Silent
    }
  };

  const handleToggleNotes = (itemId: number) => {
    if (expandedItem === itemId) {
      setExpandedItem(null);
    } else {
      setExpandedItem(itemId);
      if (!itemNotes.has(itemId)) {
        fetchNotes(itemId);
      }
    }
  };

  const handleSaveName = async () => {
    if (!editName.trim() || editName.trim() === folder?.name) {
      setEditingName(false);
      return;
    }
    try {
      const res = await fetch(`/api/folders/${folderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      });
      if (res.ok) {
        setFolder((prev) => prev ? { ...prev, name: editName.trim() } : prev);
      }
    } catch {
      // Revert
      setEditName(folder?.name || "");
    }
    setEditingName(false);
  };

  const handleSaveDesc = async () => {
    const newDesc = editDesc.trim() || null;
    if (newDesc === (folder?.description || null)) {
      setEditingDesc(false);
      return;
    }
    try {
      const res = await fetch(`/api/folders/${folderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: newDesc }),
      });
      if (res.ok) {
        setFolder((prev) => prev ? { ...prev, description: newDesc } : prev);
      }
    } catch {
      setEditDesc(folder?.description || "");
    }
    setEditingDesc(false);
  };

  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/folders/${folderId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/folders");
      }
    } catch {
      setError("Błąd usuwania teczki.");
    }
  };

  const handleArchive = async () => {
    if (!folder) return;
    try {
      const res = await fetch(`/api/folders/${folderId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !folder.is_archived }),
      });
      if (res.ok) {
        setFolder((prev) => prev ? { ...prev, is_archived: !prev.is_archived } : prev);
      }
    } catch {
      // Silent
    }
  };

  const handleRemoveItem = async (itemId: number) => {
    try {
      const res = await fetch(`/api/folders/${folderId}/items/${itemId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== itemId));
        setFolder((prev) => prev ? { ...prev, item_count: prev.item_count - 1 } : prev);
      }
    } catch {
      // Silent
    }
  };

  const handleRemoveAllItems = async () => {
    try {
      await Promise.all(
        items.map((item) =>
          fetch(`/api/folders/${folderId}/items/${item.id}`, { method: "DELETE" })
        )
      );
      setItems([]);
      setFolder((prev) => prev ? { ...prev, item_count: 0 } : prev);
    } catch {
      // Silent
    }
  };

  // ── Tag handlers ──

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    try {
      const res = await fetch(`/api/folders/${folderId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
      });
      const data = await res.json();
      if (res.ok) {
        setFolderTags((prev) => [...prev, data]);
        // If dropdown is open for an item, auto-assign the new tag
        if (tagDropdownItem !== null) {
          const item = items.find((i) => i.id === tagDropdownItem);
          if (item) {
            await fetch(`/api/folders/${folderId}/items/${tagDropdownItem}/tags`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tag_id: data.id }),
            });
            setItems((prev) => prev.map((i) =>
              i.id === tagDropdownItem ? { ...i, tags: [...i.tags, data] } : i
            ));
          }
        }
        setNewTagName("");
        setNewTagColor("#6b7280");
        setShowTagCreator(false);
      }
    } catch { /* silent */ }
  };

  const handleDeleteTag = async (tagId: number) => {
    try {
      const res = await fetch(`/api/folders/${folderId}/tags/${tagId}`, { method: "DELETE" });
      if (res.ok) {
        setFolderTags((prev) => prev.filter((t) => t.id !== tagId));
        // Remove tag from all items locally
        setItems((prev) => prev.map((item) => ({
          ...item,
          tags: item.tags.filter((t) => t.id !== tagId),
        })));
      }
    } catch { /* silent */ }
  };

  const handleToggleItemTag = async (itemId: number, tag: FolderTag, currentTags: FolderTag[]) => {
    const hasTag = currentTags.some((t) => t.id === tag.id);
    try {
      if (hasTag) {
        const res = await fetch(`/api/folders/${folderId}/items/${itemId}/tags?tag_id=${tag.id}`, { method: "DELETE" });
        if (res.ok) {
          setItems((prev) => prev.map((i) =>
            i.id === itemId ? { ...i, tags: i.tags.filter((t) => t.id !== tag.id) } : i
          ));
        }
      } else {
        const res = await fetch(`/api/folders/${folderId}/items/${itemId}/tags`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag_id: tag.id }),
        });
        if (res.ok) {
          setItems((prev) => prev.map((i) =>
            i.id === itemId ? { ...i, tags: [...i.tags, tag] } : i
          ));
        }
      }
    } catch { /* silent */ }
  };

  // ── Note edit/delete handlers ──

  const handleEditNote = async (noteId: number, content: string) => {
    try {
      const res = await fetch(`/api/folders/${folderId}/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setItemNotes((prev) => {
          const map = new Map(prev);
          for (const [itemId, notes] of map) {
            map.set(itemId, notes.map((n) => n.id === noteId ? { ...n, content } : n));
          }
          return map;
        });
        setEditingNote(null);
      }
    } catch { /* silent */ }
  };

  const handleDeleteNote = async (noteId: number, itemId: number) => {
    try {
      const res = await fetch(`/api/folders/${folderId}/notes/${noteId}`, { method: "DELETE" });
      if (res.ok) {
        setItemNotes((prev) => {
          const map = new Map(prev);
          const notes = map.get(itemId) || [];
          map.set(itemId, notes.filter((n) => n.id !== noteId));
          return map;
        });
        setItems((prev) => prev.map((i) =>
          i.id === itemId ? { ...i, note_count: Math.max(0, i.note_count - 1) } : i
        ));
      }
    } catch { /* silent */ }
  };

  const handleRemoveSearch = async (searchRecordId: number) => {
    try {
      const res = await fetch(`/api/folders/${folderId}/searches/${searchRecordId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSavedSearches((prev) => prev.filter((s) => s.id !== searchRecordId));
      }
    } catch {
      // Silent
    }
  };

  // ── Drag and drop handlers ──

  const handleDragStart = (e: React.DragEvent, itemId: number) => {
    setDragItemId(itemId);
    e.dataTransfer.effectAllowed = "move";
    // Make the drag image slightly transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "0.5";
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
    setDragItemId(null);
    setDropTargetIndex(null);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetIndex(index);
  };

  const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (dragItemId === null) return;

    const dragIndex = items.findIndex((i) => i.id === dragItemId);
    if (dragIndex === -1 || dragIndex === targetIndex) {
      setDragItemId(null);
      setDropTargetIndex(null);
      return;
    }

    // Reorder locally
    const newItems = [...items];
    const [moved] = newItems.splice(dragIndex, 1);
    newItems.splice(targetIndex, 0, moved);
    setItems(newItems);
    setDragItemId(null);
    setDropTargetIndex(null);

    // Persist to API
    try {
      await fetch(`/api/folders/${folderId}/items/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_ids: newItems.map((i) => i.id) }),
      });
    } catch {
      // Revert on failure
      fetchItems();
    }
  };

  // ── Sharing handlers ──

  const fetchShares = async () => {
    if (sharesLoaded) return;
    setSharesLoading(true);
    try {
      const [sharesRes, usersRes] = await Promise.all([
        fetch(`/api/folders/${folderId}/shares`),
        fetch("/api/users"),
      ]);
      const sharesData = await sharesRes.json();
      const usersData = await usersRes.json();
      if (sharesRes.ok) {
        setShares(sharesData.shares || []);
        setSharesOwner(sharesData.owner || null);
      }
      if (usersRes.ok) {
        setPlatformUsers(usersData.users || []);
      }
      setSharesLoaded(true);
    } catch { /* silent */ }
    finally { setSharesLoading(false); }
  };

  const handleAddShare = async () => {
    if (!shareUserId) return;
    setShareError(null);
    try {
      const res = await fetch(`/api/folders/${folderId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: shareUserId, permission: sharePermission }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShares((prev) => [...prev, data]);
      setShareUserId("");
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Błąd udostępniania.");
    }
  };

  const handleUpdateSharePermission = async (shareId: number, permission: string) => {
    try {
      await fetch(`/api/folders/${folderId}/shares/${shareId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permission }),
      });
      setShares((prev) => prev.map((s) => s.id === shareId ? { ...s, permission } : s));
    } catch { /* silent */ }
  };

  const handleRevokeShare = async (shareId: number) => {
    try {
      const res = await fetch(`/api/folders/${folderId}/shares/${shareId}`, { method: "DELETE" });
      if (res.ok) {
        setShares((prev) => prev.filter((s) => s.id !== shareId));
      }
    } catch { /* silent */ }
  };

  // ── Analysis handlers ──

  const fetchAnalyses = async (force = false) => {
    if (analysesLoaded && !force) return;
    setAnalysesLoading(true);
    try {
      const res = await fetch(`/api/folders/${folderId}/analyses`);
      const data = await res.json();
      if (res.ok) {
        setAnalyses(data.analyses || []);
        setAnalysesLoaded(true);
      }
    } catch { /* silent */ }
    finally { setAnalysesLoading(false); }
  };

  const handleDeleteAnalysis = async (analysisId: number) => {
    try {
      const res = await fetch(`/api/folders/${folderId}/analyses/${analysisId}`, { method: "DELETE" });
      if (res.ok) {
        setAnalyses((prev) => prev.filter((a) => a.id !== analysisId));
      }
    } catch { /* silent */ }
  };

  const handleAddNote = async (itemId: number, content: string) => {
    setNoteSaving(true);
    try {
      const res = await fetch(`/api/folders/${folderId}/items/${itemId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (res.ok) {
        setItemNotes((prev) => {
          const map = new Map(prev);
          const existing = map.get(itemId) || [];
          map.set(itemId, [...existing, data]);
          return map;
        });
        // Update note count
        setItems((prev) => prev.map((i) =>
          i.id === itemId ? { ...i, note_count: i.note_count + 1 } : i
        ));
      }
    } catch {
      // Silent
    } finally {
      setNoteSaving(false);
    }
  };

  const isOwner = folder?.role === "owner";
  const canWrite = folder?.role === "owner" || folder?.role === "read_write";

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      </div>
    );
  }

  if (error || !folder) {
    return (
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="rounded-lg border border-error/30 bg-error/5 p-4 text-sm text-error">
          {error || "Nie znaleziono teczki."}
        </div>
        <Link href="/folders" className="text-sm text-accent hover:underline mt-4 inline-block">
          ← Wróć do listy teczek
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link href="/folders" className="text-sm text-accent hover:underline">
          ← Teczki
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {editingName && isOwner ? (
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") { setEditName(folder.name); setEditingName(false); }
                }}
                className="text-xl font-semibold text-primary w-full rounded border border-accent/30 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            ) : (
              <h1
                className={`text-xl font-semibold text-primary ${isOwner ? "cursor-pointer hover:text-accent transition-colors" : ""}`}
                onClick={() => isOwner && setEditingName(true)}
                title={isOwner ? "Kliknij, aby edytować nazwę" : undefined}
              >
                {folder.name}
                {folder.is_archived && (
                  <span className="ml-2 text-xs font-normal text-gray-500 bg-gray-100 rounded-full px-2 py-0.5 align-middle">
                    Archiwum
                  </span>
                )}
              </h1>
            )}

            {editingDesc && isOwner ? (
              <textarea
                autoFocus
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                onBlur={handleSaveDesc}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setEditDesc(folder.description || ""); setEditingDesc(false); }
                }}
                rows={2}
                className="mt-1 w-full rounded border border-accent/30 px-2 py-1 text-sm text-muted focus:outline-none focus:ring-1 focus:ring-accent resize-y"
              />
            ) : (
              <p
                className={`text-sm text-muted mt-1 ${isOwner ? "cursor-pointer hover:text-foreground transition-colors" : ""}`}
                onClick={() => isOwner && setEditingDesc(true)}
                title={isOwner ? "Kliknij, aby edytować opis" : undefined}
              >
                {folder.description || (isOwner ? "Dodaj opis..." : "")}
              </p>
            )}
          </div>

          {/* Actions */}
          {isOwner && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleArchive}
                className="px-3 py-1.5 text-xs text-muted hover:text-foreground border border-border rounded transition-colors cursor-pointer"
              >
                {folder.is_archived ? "Przywróć" : "Archiwizuj"}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-3 py-1.5 text-xs text-error hover:bg-error/5 border border-error/30 rounded transition-colors cursor-pointer"
              >
                Usuń
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border mb-6">
        <div className="flex gap-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                if (!tab.phase1) return;
                setActiveTab(tab.key);
                if (tab.key === "ustawienia") fetchShares();
                if (tab.key === "analizy") fetchAnalyses();
              }}
              disabled={!tab.phase1}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-[1px] transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? "border-accent text-accent"
                  : tab.phase1
                    ? "border-transparent text-muted hover:text-foreground cursor-pointer"
                    : "border-transparent text-muted/40 cursor-not-allowed"
              }`}
            >
              {tab.label}
              {!tab.phase1 && (
                <span className="ml-1 text-[10px] text-muted/40">wkrótce</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "orzeczenia" && (
        <div>
          {itemsLoading ? (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
          ) : items.length === 0 && savedSearches.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted">
                Ta teczka jest pusta.
              </p>
              <p className="text-xs text-muted mt-1">
                Dodaj orzeczenia lub zapisz wyszukiwania z poziomu wyszukiwarki.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Saved searches */}
              {savedSearches.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
                    Zapisane wyszukiwania ({savedSearches.length})
                  </h3>
                  <div className="space-y-2">
                    {savedSearches.map((search) => (
                      <div key={search.id} className="rounded-lg border border-border bg-card p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <Link
                              href={search.search_id ? `/search/${search.search_id}` : "#"}
                              className="text-sm font-medium text-accent hover:underline"
                            >
                              {search.query_text}
                            </Link>
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted">
                              <span>
                                {new Date(search.created_at).toLocaleDateString("pl-PL")}
                              </span>
                              {search.added_by_email && (
                                <span>dodane przez {search.added_by_email}</span>
                              )}
                            </div>
                          </div>
                          {canWrite && (
                            <button
                              onClick={() => handleRemoveSearch(search.id)}
                              className="text-muted hover:text-error transition-colors p-1 cursor-pointer shrink-0"
                              title="Usuń z teczki"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Verdicts */}
              {items.length > 0 && (
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-medium text-muted uppercase tracking-wide">
                    Orzeczenia ({items.length})
                  </h3>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
                        const header = "Sygnatura;Data;Typ;Rozstrzygnięcie;Streszczenie;Link";
                        const rows = items.map((item) =>
                          [
                            item.sygnatura,
                            item.verdict_date ? formatPolishDate(item.verdict_date) : "",
                            item.document_type_normalized || "",
                            item.decision_type_normalized || "",
                            (item.summary || "").replace(/;/g, ",").replace(/\n/g, " "),
                            `${baseUrl}/verdict/${item.verdict_id}`,
                          ].join(";")
                        );
                        const csv = "\uFEFF" + [header, ...rows].join("\n");
                        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${folder?.name || "teczka"}_orzeczenia.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="text-xs text-accent hover:underline cursor-pointer"
                    >
                      Eksportuj CSV
                    </button>
                    {canWrite && (
                      <button
                        onClick={() => setRemoveAllConfirm(true)}
                        className="text-xs text-error/70 hover:text-error transition-colors cursor-pointer"
                      >
                        Usuń wszystkie
                      </button>
                    )}
                  </div>
                </div>
              )}

              {items.map((item, index) => (
                <div key={item.id}>
                  {/* Drop zone indicator — above this item */}
                  {dragItemId !== null && dropTargetIndex === index && dragItemId !== item.id && (
                    <div className="h-1 bg-accent rounded-full mx-2 mb-1 transition-all" />
                  )}
                  <div
                    draggable={canWrite}
                    onDragStart={(e) => handleDragStart(e, item.id)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    className={`rounded-lg border bg-card transition-all ${
                      dragItemId === item.id
                        ? "border-accent/40 opacity-50"
                        : "border-border"
                    }`}
                  >
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        {/* Drag handle */}
                        {canWrite && (
                          <div className="mt-0.5 cursor-grab active:cursor-grabbing text-muted/40 hover:text-muted shrink-0" title="Przeciągnij, aby zmienić kolejność">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <circle cx="9" cy="5" r="1.5" /><circle cx="15" cy="5" r="1.5" />
                              <circle cx="9" cy="10" r="1.5" /><circle cx="15" cy="10" r="1.5" />
                              <circle cx="9" cy="15" r="1.5" /><circle cx="15" cy="15" r="1.5" />
                              <circle cx="9" cy="20" r="1.5" /><circle cx="15" cy="20" r="1.5" />
                            </svg>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <Link
                            href={`/verdict/${item.verdict_id}`}
                            className="text-sm font-semibold text-accent hover:underline"
                          >
                            {item.sygnatura}
                          </Link>
                          {item.verdict_date && (
                            <span className="text-xs text-muted">
                              {formatPolishDate(item.verdict_date)}
                            </span>
                          )}
                          {item.decision_type_normalized && (
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                decisionColor[item.decision_type_normalized] ||
                                "bg-gray-50 text-gray-600 border border-gray-200"
                              }`}
                            >
                              {decisionLabel[item.decision_type_normalized] ||
                                item.decision_type_normalized}
                            </span>
                          )}
                        </div>
                        {item.summary && (
                          <p className="text-xs text-muted mt-1 leading-relaxed">
                            {item.summary}
                          </p>
                        )}
                        {/* Item tags */}
                        {(item.tags.length > 0 || (canWrite && folderTags.length > 0)) && (
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            {item.tags.map((tag) => (
                              <span
                                key={tag.id}
                                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                                style={{ backgroundColor: tag.color + "18", color: tag.color, border: `1px solid ${tag.color}40` }}
                              >
                                {tag.name}
                                {canWrite && (
                                  <button
                                    onClick={() => handleToggleItemTag(item.id, tag, item.tags)}
                                    className="hover:opacity-70 cursor-pointer leading-none"
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            ))}
                            {canWrite && (
                              <div className="relative" ref={tagDropdownItem === item.id ? tagDropdownRef : undefined}>
                                <button
                                  onClick={() => {
                                    setTagDropdownItem(tagDropdownItem === item.id ? null : item.id);
                                    setShowTagCreator(false);
                                    setNewTagName("");
                                  }}
                                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted/40 px-2 py-0.5 text-[10px] text-muted hover:border-accent hover:text-accent transition-colors cursor-pointer"
                                >
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                  </svg>
                                  Tag
                                </button>
                                {tagDropdownItem === item.id && (
                                  <div className="absolute left-0 top-full mt-1 rounded-md border border-border bg-card shadow-md p-1.5 z-10 min-w-[160px]">
                                    {folderTags.map((tag) => {
                                      const isActive = item.tags.some((t) => t.id === tag.id);
                                      return (
                                        <button
                                          key={tag.id}
                                          onClick={() => handleToggleItemTag(item.id, tag, item.tags)}
                                          className={`flex items-center gap-2 w-full px-2 py-1.5 text-xs text-left rounded transition-colors cursor-pointer ${
                                            isActive ? "bg-accent/5" : "hover:bg-accent/5"
                                          }`}
                                        >
                                          <span className="w-3 h-3 rounded-full shrink-0 border" style={{ backgroundColor: isActive ? tag.color : "transparent", borderColor: tag.color }} />
                                          <span className={isActive ? "font-medium" : ""}>{tag.name}</span>
                                          {isActive && <span className="ml-auto text-accent">✓</span>}
                                        </button>
                                      );
                                    })}
                                    {folderTags.length > 0 && <div className="border-t border-border my-1" />}
                                    {!showTagCreator ? (
                                      <button
                                        onClick={() => setShowTagCreator(true)}
                                        className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-accent text-left rounded hover:bg-accent/5 cursor-pointer"
                                      >
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                        </svg>
                                        Nowy tag
                                      </button>
                                    ) : (
                                      <div className="px-1.5 py-1.5 space-y-1.5">
                                        <div className="flex items-center gap-1.5">
                                          <input
                                            type="color"
                                            value={newTagColor}
                                            onChange={(e) => setNewTagColor(e.target.value)}
                                            className="w-5 h-5 rounded border border-border cursor-pointer shrink-0"
                                          />
                                          <input
                                            type="text"
                                            autoFocus
                                            value={newTagName}
                                            onChange={(e) => setNewTagName(e.target.value)}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter" && newTagName.trim()) handleCreateTag();
                                              if (e.key === "Escape") { setShowTagCreator(false); setNewTagName(""); }
                                            }}
                                            placeholder="Nazwa"
                                            className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                                          />
                                        </div>
                                        <button
                                          onClick={handleCreateTag}
                                          disabled={!newTagName.trim()}
                                          className="w-full text-center text-xs text-accent hover:underline disabled:opacity-50 cursor-pointer py-0.5"
                                        >
                                          Utwórz
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Note count / toggle */}
                        <button
                          onClick={() => handleToggleNotes(item.id)}
                          className={`text-xs px-2 py-1 rounded transition-colors ${
                            expandedItem === item.id
                              ? "bg-accent/10 text-accent"
                              : "text-muted hover:text-foreground"
                          }`}
                        >
                          {item.note_count > 0 ? pluralNotatki(item.note_count) : "Notatki"}
                        </button>

                        {/* Remove */}
                        {canWrite && (
                          <button
                            onClick={() => setRemoveItemConfirm(item)}
                            className="text-muted hover:text-error transition-colors p-1 cursor-pointer"
                            title="Usuń z teczki"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded notes */}
                  {expandedItem === item.id && (
                    <div className="border-t border-border px-4 py-3 bg-background/50">
                      {/* Existing notes */}
                      {(itemNotes.get(item.id) || []).length > 0 ? (
                        <div className="space-y-3 mb-4">
                          {(itemNotes.get(item.id) || []).map((note) => (
                            <div key={note.id} className="text-sm">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-medium text-foreground">
                                  {note.author_email}
                                </span>
                                <span className="text-xs text-muted">
                                  {new Date(note.created_at).toLocaleDateString("pl-PL")}
                                </span>
                                {canWrite && (
                                  <span className="flex items-center gap-1 ml-auto">
                                    {note.author_id === folder?.owner_id || note.author_id === folder?.owner_id && (
                                      null
                                    )}
                                    <button
                                      onClick={() => { setEditingNote(note.id); setEditNoteContent(note.content); }}
                                      className="text-[11px] text-muted hover:text-accent transition-colors cursor-pointer"
                                    >
                                      Edytuj
                                    </button>
                                    <button
                                      onClick={() => handleDeleteNote(note.id, item.id)}
                                      className="text-[11px] text-muted hover:text-error transition-colors cursor-pointer"
                                    >
                                      Usuń
                                    </button>
                                  </span>
                                )}
                              </div>
                              {editingNote === note.id ? (
                                <div className="space-y-2">
                                  <textarea
                                    value={editNoteContent}
                                    onChange={(e) => setEditNoteContent(e.target.value)}
                                    rows={3}
                                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent resize-y"
                                  />
                                  <div className="flex gap-2 justify-end">
                                    <button
                                      onClick={() => setEditingNote(null)}
                                      className="text-xs text-muted hover:text-foreground cursor-pointer"
                                    >
                                      Anuluj
                                    </button>
                                    <button
                                      onClick={() => handleEditNote(note.id, editNoteContent)}
                                      disabled={!editNoteContent.trim()}
                                      className="text-xs text-accent hover:underline disabled:opacity-50 cursor-pointer"
                                    >
                                      Zapisz
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="prose prose-sm max-w-none text-sm text-foreground/80">
                                  <ReactMarkdown>{note.content}</ReactMarkdown>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted mb-3">Brak notatek.</p>
                      )}

                      {/* Add note */}
                      {canWrite && (
                        <NoteEditor
                          onSave={(content) => handleAddNote(item.id, content)}
                          loading={noteSaving}
                        />
                      )}
                    </div>
                  )}
                  </div>
                </div>
              ))}
              {/* Drop zone at the very end */}
              {items.length > 0 && (
                <div
                  onDragOver={(e) => handleDragOver(e, items.length)}
                  onDrop={(e) => handleDrop(e, items.length)}
                  className="h-4"
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Analizy tab */}
      {activeTab === "analizy" && (
        <div>
          {showCreateAnalysis ? (
            <CreateAnalysisFlow
              folderId={folderId}
              items={items}
              onClose={() => setShowCreateAnalysis(false)}
              onComplete={() => fetchAnalyses(true)}
            />
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-medium text-muted uppercase tracking-wide">
                  {analyses.length > 0 ? `Analizy (${analyses.length})` : "Analizy"}
                </h3>
                {canWrite && items.length > 0 && (
                  <button
                    onClick={() => setShowCreateAnalysis(true)}
                    className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/90 transition-colors cursor-pointer"
                  >
                    Nowa analiza
                  </button>
                )}
              </div>

              {analysesLoading && !analysesLoaded && (
                <div className="flex justify-center py-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                </div>
              )}

              {analysesLoaded && analyses.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-sm text-muted">Brak analiz.</p>
                  {items.length > 0 ? (
                    <button
                      onClick={() => setShowCreateAnalysis(true)}
                      className="mt-2 text-sm text-accent hover:underline cursor-pointer"
                    >
                      Utwórz pierwszą analizę
                    </button>
                  ) : (
                    <p className="text-xs text-muted mt-1">Dodaj orzeczenia do teczki, aby móc je analizować.</p>
                  )}
                </div>
              )}

              {analyses.length > 0 && (
                <div className="space-y-3">
                  {analyses.map((analysis) => (
                    <AnalysisCard
                      key={analysis.id}
                      analysis={analysis}
                      folderId={folderId}
                      onDelete={canWrite ? handleDeleteAnalysis : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Udostępnianie tab */}
      {activeTab === "ustawienia" && (
        <div>
          {!isOwner ? (
            <div className="rounded-lg border border-border bg-card p-6 text-center">
              <svg className="w-8 h-8 mx-auto text-muted/30 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <p className="text-sm text-muted">
                Tylko właściciel teczki może zarządzać udostępnianiem.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card">
              {sharesLoading && !sharesLoaded ? (
                <div className="flex justify-center py-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                </div>
              ) : (
                <div>
                  {shareError && (
                    <div className="mx-4 mt-4 rounded-lg border border-error/30 bg-error/5 p-3 text-xs text-error">
                      {shareError}
                    </div>
                  )}

                  {/* People list */}
                  <div className="divide-y divide-border/50">
                    {/* Owner row */}
                    {sharesOwner && (
                      <div className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-xs font-medium text-accent">
                            {sharesOwner.email.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <span className="text-sm text-foreground">{sharesOwner.email}</span>
                          </div>
                        </div>
                        <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent">
                          Właściciel
                        </span>
                      </div>
                    )}

                    {/* Shared user rows */}
                    {shares.map((share) => (
                      <div key={share.id} className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-muted/10 flex items-center justify-center text-xs font-medium text-muted">
                            {share.email.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm text-foreground">{share.email}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={share.permission}
                            onChange={(e) => handleUpdateSharePermission(share.id, e.target.value)}
                            className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                          >
                            <option value="read">Podgląd</option>
                            <option value="read_write">Edycja</option>
                          </select>
                          <button
                            onClick={() => handleRevokeShare(share.id)}
                            className="text-muted/40 hover:text-error transition-colors cursor-pointer p-1"
                            title="Usuń dostęp"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}

                    {/* Add person row */}
                    <div className="px-4 py-3" ref={shareDropdownRef}>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full border-2 border-dashed border-muted/30 flex items-center justify-center text-muted/40">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                          </svg>
                        </div>
                        <div className="flex-1 relative">
                          <input
                            type="text"
                            value={shareSearch}
                            onChange={(e) => { setShareSearch(e.target.value); setShareDropdownOpen(true); setShareUserId(""); }}
                            onFocus={() => setShareDropdownOpen(true)}
                            placeholder="Dodaj osobę..."
                            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                          {shareDropdownOpen && (() => {
                            const available = platformUsers
                              .filter((u) => !shares.some((s) => s.user_id === u.id))
                              .filter((u) => !shareSearch || u.email.toLowerCase().includes(shareSearch.toLowerCase()));
                            return (
                              <div className="absolute left-0 right-0 top-full mt-1 rounded-md border border-border bg-card shadow-lg z-10 max-h-[200px] overflow-y-auto">
                                {available.length > 0 ? available.map((u) => (
                                  <button
                                    key={u.id}
                                    onClick={() => {
                                      setShareUserId(u.id);
                                      setShareSearch(u.email);
                                      setShareDropdownOpen(false);
                                    }}
                                    className="flex items-center gap-2.5 w-full text-left px-3 py-2 text-sm hover:bg-accent/5 transition-colors cursor-pointer"
                                  >
                                    <span className="w-6 h-6 rounded-full bg-muted/10 flex items-center justify-center text-[10px] font-medium text-muted shrink-0">
                                      {u.email.charAt(0).toUpperCase()}
                                    </span>
                                    {u.email}
                                  </button>
                                )) : (
                                  <p className="px-3 py-2 text-xs text-muted">
                                    {shareSearch ? "Nie znaleziono użytkownika" : "Brak dostępnych użytkowników"}
                                  </p>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        <select
                          value={sharePermission}
                          onChange={(e) => setSharePermission(e.target.value)}
                          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                        >
                          <option value="read">Podgląd</option>
                          <option value="read_write">Edycja</option>
                        </select>
                        <button
                          onClick={() => {
                            handleAddShare();
                            setShareSearch("");
                            setShareUserId("");
                          }}
                          disabled={!shareUserId}
                          className="px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          Dodaj
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Help text */}
                  {sharesLoaded && shares.length === 0 && (
                    <div className="px-4 pb-4">
                      <p className="text-xs text-muted">
                        Osoby z dostępem „Podgląd" mogą przeglądać orzeczenia i analizy.
                        Osoby z dostępem „Edycja" mogą dodatkowo dodawać orzeczenia, notatki i tworzyć analizy.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Remove all items confirmation modal */}
      {removeAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg shadow-lg p-6 w-full max-w-sm mx-4">
            <h2 className="text-sm font-semibold text-primary mb-2">Usuń wszystkie orzeczenia</h2>
            <p className="text-xs text-muted mb-4">
              Czy na pewno chcesz usunąć wszystkie {items.length} orzeczeń z tej teczki?
              Notatki powiązane z orzeczeniami również zostaną usunięte.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRemoveAllConfirm(false)}
                className="px-3 py-1.5 text-xs text-muted hover:text-primary transition-colors cursor-pointer"
              >
                Anuluj
              </button>
              <button
                onClick={() => {
                  handleRemoveAllItems();
                  setRemoveAllConfirm(false);
                }}
                className="px-3 py-1.5 text-xs bg-error text-white rounded hover:bg-error/90 transition-colors cursor-pointer"
              >
                Usuń wszystkie
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove item confirmation modal */}
      {removeItemConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg shadow-lg p-6 w-full max-w-sm mx-4">
            <h2 className="text-sm font-semibold text-primary mb-2">Usuń orzeczenie z teczki</h2>
            <p className="text-xs text-muted mb-4">
              Czy na pewno chcesz usunąć orzeczenie {removeItemConfirm.sygnatura} z tej teczki?
              Notatki powiązane z tym orzeczeniem również zostaną usunięte.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRemoveItemConfirm(null)}
                className="px-3 py-1.5 text-xs text-muted hover:text-primary transition-colors cursor-pointer"
              >
                Anuluj
              </button>
              <button
                onClick={() => {
                  handleRemoveItem(removeItemConfirm.id);
                  setRemoveItemConfirm(null);
                }}
                className="px-3 py-1.5 text-xs bg-error text-white rounded hover:bg-error/90 transition-colors cursor-pointer"
              >
                Usuń z teczki
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg shadow-lg p-6 w-full max-w-sm mx-4">
            <h2 className="text-sm font-semibold text-primary mb-2">Usuń teczkę</h2>
            <p className="text-xs text-muted mb-4">
              Czy na pewno chcesz usunąć teczkę &ldquo;{folder.name}&rdquo;?
              Wszystkie orzeczenia, notatki i analizy w tej teczce zostaną trwale usunięte.
              Tej operacji nie można cofnąć.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 text-xs text-muted hover:text-primary transition-colors cursor-pointer"
              >
                Anuluj
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 text-xs bg-error text-white rounded hover:bg-error/90 transition-colors cursor-pointer"
              >
                Usuń teczkę
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
