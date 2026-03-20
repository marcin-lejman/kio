"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

function ConfirmContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as
    | "invite"
    | "recovery"
    | "email"
    | "signup"
    | null;

  async function handleConfirm() {
    if (!tokenHash || !type) return;

    setLoading(true);
    setError("");

    const supabase = createBrowserClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });

    if (verifyError) {
      setError("Link jest nieprawidłowy lub wygasł. Poproś administratora o ponowne wysłanie zaproszenia.");
      setLoading(false);
      return;
    }

    router.replace("/auth/set-password");
  }

  if (!tokenHash || !type) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <h1 className="text-lg font-semibold text-primary mb-1">
              Nieprawidłowy link
            </h1>
            <p className="text-sm text-muted mb-6">
              Link aktywacyjny jest nieprawidłowy. Poproś administratora o
              ponowne wysłanie zaproszenia.
            </p>
            <a
              href="/login"
              className="block w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white text-center hover:bg-accent/90 transition-colors"
            >
              Przejdź do logowania
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-primary mb-1">
            Potwierdź konto
          </h1>
          <p className="text-sm text-muted mb-6">
            Kliknij poniższy przycisk, aby aktywować swoje konto i ustawić
            hasło.
          </p>

          {error && <p className="text-sm text-error mb-4">{error}</p>}

          <button
            onClick={handleConfirm}
            disabled={loading}
            className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {loading ? "Aktywowanie..." : "Aktywuj konto"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      }
    >
      <ConfirmContent />
    </Suspense>
  );
}
