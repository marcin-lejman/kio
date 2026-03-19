"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const suspended = searchParams.get("suspended") === "true";
  const urlError = searchParams.get("error");

  function getErrorMessage(code: string): string {
    switch (code) {
      case "invalid_link":
        return "Link jest nieprawidłowy lub wygasł.";
      case "session_expired":
        return "Sesja wygasła. Zaloguj się ponownie.";
      default:
        return "Wystąpił błąd.";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(
        signInError.message === "Invalid login credentials"
          ? "Nieprawidłowy email lub hasło."
          : signInError.message
      );
      setLoading(false);
      return;
    }

    // "Remember me" unchecked: convert cookies to session cookies
    // by removing max-age so they expire when the browser closes
    if (!rememberMe) {
      document.cookie.split(";").forEach((c) => {
        const name = c.trim().split("=")[0];
        if (name.startsWith("sb-")) {
          const value = c.trim().split("=").slice(1).join("=");
          document.cookie = `${name}=${value}; path=/; SameSite=Lax; Secure`;
        }
      });
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-primary mb-1">
        Wyszukiwarka KIO
      </h1>
      <p className="text-sm text-muted mb-6">
        Zaloguj się, aby kontynuować.
      </p>

      {suspended && (
        <div className="mb-4 rounded-md bg-error/10 border border-error/20 p-3">
          <p className="text-sm text-error">
            Twoje konto zostało zawieszone. Skontaktuj się z administratorem.
          </p>
        </div>
      )}

      {urlError && !suspended && (
        <div className="mb-4 rounded-md bg-warning/10 border border-warning/20 p-3">
          <p className="text-sm text-warning">
            {getErrorMessage(urlError)}
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder="nazwa@example.com"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Hasło
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="rememberMe"
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
          <label htmlFor="rememberMe" className="text-sm text-muted">
            Zapamiętaj mnie
          </label>
        </div>

        {error && <p className="text-sm text-error">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {loading ? "Logowanie..." : "Zaloguj się"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
