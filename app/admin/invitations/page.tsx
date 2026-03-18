"use client";

import { useCallback, useEffect, useState } from "react";

interface Invitation {
  id: string;
  email: string;
  role: string;
  invited_at: string;
}

export default function AdminInvitationsPage() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Invite form
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"regular" | "admin">("regular");
  const [inviting, setInviting] = useState(false);

  const fetchInvitations = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/invitations");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInvitations(data.invitations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd ładowania");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setInviting(true);

    try {
      const res = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess(`Zaproszenie wysłane do ${email}.`);
      setEmail("");
      setRole("regular");
      await fetchInvitations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd wysyłania zaproszenia");
    } finally {
      setInviting(false);
    }
  }

  async function handleResend(id: string) {
    setActionLoading(id);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/invitations/${id}/resend`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess("Zaproszenie wysłane ponownie.");
      await fetchInvitations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd ponownego wysyłania");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRevoke(id: string, email: string) {
    if (!confirm(`Czy na pewno chcesz anulować zaproszenie dla ${email}?`))
      return;

    setActionLoading(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/invitations/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchInvitations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd anulowania");
    } finally {
      setActionLoading(null);
    }
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString("pl-PL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-xl font-semibold text-primary mb-6">Zaproszenia</h1>

      {/* Invite form */}
      <div className="rounded-lg border border-border bg-card p-4 mb-6">
        <h2 className="text-sm font-semibold text-primary mb-3">
          Zaproś nowego użytkownika
        </h2>
        <form onSubmit={handleInvite} className="flex items-end gap-3">
          <div className="flex-1">
            <label
              htmlFor="invite-email"
              className="block text-xs font-medium text-muted mb-1"
            >
              Email
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="nazwa@example.com"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <label
              htmlFor="invite-role"
              className="block text-xs font-medium text-muted mb-1"
            >
              Rola
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) =>
                setRole(e.target.value as "regular" | "admin")
              }
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="regular">regular</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={inviting}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {inviting ? "Wysyłanie..." : "Zaproś"}
          </button>
        </form>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-error/10 border border-error/20 p-3">
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-md bg-success/10 border border-success/20 p-3">
          <p className="text-sm text-success">{success}</p>
        </div>
      )}

      {/* Pending invitations table */}
      <h2 className="text-sm font-semibold text-primary mb-3">
        Oczekujące zaproszenia
      </h2>

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
                  Data zaproszenia
                </th>
                <th className="text-right py-2 px-3 font-medium text-muted">
                  Akcje
                </th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id} className="border-b border-border/50">
                  <td className="py-2 px-3">{inv.email}</td>
                  <td className="py-2 px-3 text-xs text-muted">{inv.role}</td>
                  <td className="py-2 px-3 text-xs text-muted">
                    {formatDate(inv.invited_at)}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleResend(inv.id)}
                        disabled={actionLoading === inv.id}
                        className="text-xs text-muted hover:text-accent transition-colors disabled:opacity-50"
                      >
                        Wyślij ponownie
                      </button>
                      <button
                        onClick={() => handleRevoke(inv.id, inv.email)}
                        disabled={actionLoading === inv.id}
                        className="text-xs text-muted hover:text-error transition-colors disabled:opacity-50"
                      >
                        Anuluj
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {invitations.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="py-8 text-center text-sm text-muted"
                  >
                    Brak oczekujących zaproszeń.
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
