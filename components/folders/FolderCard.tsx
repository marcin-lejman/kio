"use client";

import Link from "next/link";
import type { Folder } from "./types";

function pluralOrzeczenia(n: number): string {
  if (n === 1) return "1 orzeczenie";
  const lastTwo = n % 100;
  const lastOne = n % 10;
  if (lastTwo >= 12 && lastTwo <= 14) return `${n} orzeczeń`;
  if (lastOne >= 2 && lastOne <= 4) return `${n} orzeczenia`;
  return `${n} orzeczeń`;
}

function pluralWyszukiwania(n: number): string {
  if (n === 1) return "1 wyszukiwanie";
  const lastTwo = n % 100;
  const lastOne = n % 10;
  if (lastTwo >= 12 && lastTwo <= 14) return `${n} wyszukiwań`;
  if (lastOne >= 2 && lastOne <= 4) return `${n} wyszukiwania`;
  return `${n} wyszukiwań`;
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH = Math.floor(diffMs / 3_600_000);
  const diffD = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "przed chwilą";
  if (diffMin < 60) return `${diffMin} min temu`;
  if (diffH < 24) return `${diffH} godz. temu`;
  if (diffD < 30) return `${diffD} dn. temu`;
  return date.toLocaleDateString("pl-PL");
}

export function FolderCard({ folder }: { folder: Folder }) {
  const isOwner = folder.role === "owner";

  return (
    <Link
      href={`/folders/${folder.id}`}
      className="block rounded-lg border border-border bg-card p-4 hover:border-accent/30 transition-colors group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-primary truncate group-hover:text-accent transition-colors">
            {folder.name}
          </h3>
          {folder.description && (
            <p className="text-sm text-muted mt-0.5 line-clamp-2">{folder.description}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!isOwner && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
              Udostępnione
            </span>
          )}
          {folder.is_archived && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
              Archiwum
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 mt-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {pluralOrzeczenia(folder.item_count)}
        </span>

        {(folder.search_count || 0) > 0 && (
          <span className="inline-flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {pluralWyszukiwania(folder.search_count)}
          </span>
        )}

        <span>{formatRelativeDate(folder.updated_at)}</span>

      </div>
    </Link>
  );
}
