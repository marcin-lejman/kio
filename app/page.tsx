"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SearchBar } from "@/components/search";
import type { SearchFilters } from "@/components/search";

export default function SearchPage() {
  const router = useRouter();
  const [verdictCount, setVerdictCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d) => setVerdictCount(d.verdict_count))
      .catch(() => {});
  }, []);

  const handleSearch = useCallback(
    (query: string, filters: SearchFilters, answerModel: string) => {
      sessionStorage.setItem(
        "pending_search",
        JSON.stringify({ query, filters, answerModel })
      );
      router.push("/search/pending");
    },
    [router]
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
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
        <SearchBar onSearch={handleSearch} loading={false} />
      </div>
    </div>
  );
}
