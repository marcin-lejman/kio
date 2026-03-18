"use client";

import { useCallback, useEffect, useState } from "react";

interface UserRow {
  id: string;
  email: string;
  role: "regular" | "admin";
  suspended: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd ładowania");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function handleAction(
    userId: string,
    action: string,
    method: string,
    body?: Record<string, unknown>,
    confirmMsg?: string
  ) {
    if (confirmMsg && !confirm(confirmMsg)) return;

    setActionLoading(userId);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${userId}${action}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd operacji");
    } finally {
      setActionLoading(null);
    }
  }

  function formatDate(d: string | null) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("pl-PL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-xl font-semibold text-primary mb-6">
        Zarządzanie użytkownikami
      </h1>

      {error && (
        <div className="mb-4 rounded-md bg-error/10 border border-error/20 p-3">
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted">
                  Email
                </th>
                <th className="text-left py-2 px-3 font-medium text-muted">
                  Rola
                </th>
                <th className="text-left py-2 px-3 font-medium text-muted">
                  Status
                </th>
                <th className="text-left py-2 px-3 font-medium text-muted">
                  Utworzony
                </th>
                <th className="text-left py-2 px-3 font-medium text-muted">
                  Ostatnie logowanie
                </th>
                <th className="text-right py-2 px-3 font-medium text-muted">
                  Akcje
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border/50">
                  <td className="py-2 px-3">{u.email}</td>
                  <td className="py-2 px-3">
                    <select
                      value={u.role}
                      disabled={actionLoading === u.id}
                      onChange={(e) =>
                        handleAction(u.id, "", "PATCH", {
                          role: e.target.value,
                        })
                      }
                      className="rounded border border-border bg-background px-2 py-1 text-xs"
                    >
                      <option value="regular">regular</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="py-2 px-3">
                    {u.suspended ? (
                      <span className="inline-block rounded bg-error/10 px-2 py-0.5 text-xs font-medium text-error">
                        zawieszony
                      </span>
                    ) : (
                      <span className="inline-block rounded bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                        aktywny
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-muted text-xs">
                    {formatDate(u.created_at)}
                  </td>
                  <td className="py-2 px-3 text-muted text-xs">
                    {formatDate(u.last_sign_in_at)}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() =>
                          handleAction(u.id, "/suspend", "POST", {
                            suspend: !u.suspended,
                          })
                        }
                        disabled={actionLoading === u.id}
                        className="text-xs text-muted hover:text-warning transition-colors disabled:opacity-50"
                      >
                        {u.suspended ? "Odblokuj" : "Zawieś"}
                      </button>
                      <button
                        onClick={() =>
                          handleAction(u.id, "/reset-password", "POST")
                        }
                        disabled={actionLoading === u.id}
                        className="text-xs text-muted hover:text-accent transition-colors disabled:opacity-50"
                      >
                        Reset hasła
                      </button>
                      <button
                        onClick={() =>
                          handleAction(
                            u.id,
                            "",
                            "DELETE",
                            undefined,
                            `Czy na pewno chcesz usunąć użytkownika ${u.email}? Tej operacji nie można cofnąć.`
                          )
                        }
                        disabled={actionLoading === u.id}
                        className="text-xs text-muted hover:text-error transition-colors disabled:opacity-50"
                      >
                        Usuń
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="py-8 text-center text-sm text-muted"
                  >
                    Brak użytkowników.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
