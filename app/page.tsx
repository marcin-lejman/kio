"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SearchBar } from "@/components/search";
import type { SearchFilters } from "@/components/search";
import { parseSygnatura } from "@/lib/sygnatura";

export default function SearchPage() {
  const router = useRouter();
  const [verdictCount, setVerdictCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d) => setVerdictCount(d.verdict_count))
      .catch(() => {});
  }, []);

  const handleSearch = useCallback(
    async (query: string, filters: SearchFilters, answerModel: string) => {
      const syg = parseSygnatura(query);
      if (syg) {
        setLoading(true);
        try {
          const res = await fetch(
            `/api/verdict/by-sygnatura?q=${encodeURIComponent(syg)}`
          );
          const data = await res.json();
          if (data.found) {
            router.push(`/verdict/${data.verdict_id}`);
            return;
          }
        } catch {
          // fall through to normal search
        } finally {
          setLoading(false);
        }
      }

      sessionStorage.setItem(
        "pending_search",
        JSON.stringify({ query, filters, answerModel })
      );
      router.push("/search/pending");
    },
    [router]
  );

  return (
    <div className="mx-auto flex min-h-[calc(100vh-57px)] max-w-3xl flex-col items-center pt-[25vh] px-4">
      <div className="w-full">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-primary mb-2">
            Wyszukiwarka orzeczeń KIO
          </h1>
          <p className="text-sm text-muted">
            Przeszukaj{" "}
            {verdictCount !== null
              ? `${verdictCount.toLocaleString("pl-PL")} orzeczeń`
              : "bazę orzeczeń"}{" "}
            Krajowej Izby Odwoławczej
          </p>
        </div>
        <SearchBar onSearch={handleSearch} loading={loading} />
      </div>
    </div>
  );
}
