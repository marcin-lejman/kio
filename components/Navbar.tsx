"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

interface NavLink {
  href: string;
  label: string;
  exact?: boolean;
}

const APP_LINKS: NavLink[] = [
  { href: "/", label: "Szukaj", exact: true },
  { href: "/browse", label: "Orzeczenia" },
  { href: "/history", label: "Historia" },
];

const ADMIN_LINKS: NavLink[] = [
  { href: "/admin", label: "Użytkownicy", exact: true },
  { href: "/admin/invitations", label: "Zaproszenia" },
  { href: "/admin/costs", label: "Koszty" },
  { href: "/admin/system", label: "System info" },
];

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAdmin = user?.app_metadata?.role === "admin";
  const onAdminPage = pathname.startsWith("/admin");
  const links = onAdminPage ? ADMIN_LINKS : APP_LINKS;

  useEffect(() => {
    const supabase = createBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function handleLogout() {
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  // Don't render nav while checking auth or when logged out
  if (loading || !user) return null;

  return (
    <nav className="border-b border-border bg-card">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          {/* Left: links */}
          <div className="flex items-center">
            {/* Desktop links */}
            <div className="hidden md:flex items-center gap-1">
              {onAdminPage && (
                <Link
                  href="/"
                  className="mr-2 rounded-md px-2.5 py-1.5 text-sm text-muted hover:text-foreground hover:bg-background transition-colors"
                >
                  &larr; Wyszukiwarka
                </Link>
              )}
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                    isActive(link.href, link.exact)
                      ? "bg-accent/10 text-accent font-medium"
                      : "text-muted hover:text-foreground hover:bg-background"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Right: user area (desktop) + hamburger (mobile) */}
          <div className="flex items-center gap-3">
            {/* Desktop user dropdown */}
            <div className="hidden md:block relative group">
              <button className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted hover:text-foreground transition-colors">
                {isAdmin && (
                  <span className="h-2 w-2 rounded-full bg-accent flex-shrink-0" />
                )}
                <span className="max-w-[200px] truncate">{user.email}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-50">
                  <path d="M3 5l3 3 3-3" />
                </svg>
              </button>
              <div className="absolute right-0 top-full pt-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-50">
                <div className="min-w-[180px] rounded-md border border-border bg-card shadow-lg py-1">
                  {isAdmin && (
                    <Link
                      href="/admin"
                      className="block px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-background transition-colors"
                    >
                      Ustawienia
                    </Link>
                  )}
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-3 py-2 text-sm text-muted hover:text-error hover:bg-error/5 transition-colors"
                  >
                    Wyloguj
                  </button>
                </div>
              </div>
            </div>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden rounded-md p-2 text-muted hover:text-foreground hover:bg-background transition-colors"
              aria-label="Menu"
            >
              {mobileOpen ? (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 5h14M3 10h14M3 15h14" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-card">
          <div className="px-4 py-3 space-y-1">
            {onAdminPage && (
              <Link
                href="/"
                className="block rounded-md px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-background transition-colors"
              >
                &larr; Wyszukiwarka
              </Link>
            )}
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive(link.href, link.exact)
                    ? "bg-accent/10 text-accent font-medium"
                    : "text-muted hover:text-foreground hover:bg-background"
                }`}
              >
                {link.label}
              </Link>
            ))}

            {/* Mobile user section */}
            <div className="pt-3 mt-3 border-t border-border">
              <div className="px-3 py-1">
                <span className="text-sm text-muted truncate block">
                  {user.email}
                </span>
              </div>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="block rounded-md px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-background transition-colors"
                >
                  Ustawienia
                </Link>
              )}
              <button
                onClick={handleLogout}
                className="w-full text-left rounded-md px-3 py-2 text-sm text-muted hover:text-error hover:bg-error/5 transition-colors"
              >
                Wyloguj
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
