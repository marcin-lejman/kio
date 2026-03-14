import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Wyszukiwarka KIO",
  description: "Wyszukiwarka orzeczeń Krajowej Izby Odwoławczej",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased min-h-screen`}
      >
        <nav className="border-b border-border bg-card">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex h-14 items-center justify-between">
              <div className="flex items-center gap-8">
                <Link
                  href="/"
                  className="text-lg font-semibold text-primary tracking-tight"
                >
                  Wyszukiwarka KIO
                </Link>
                <div className="hidden sm:flex items-center gap-6">
                  <Link
                    href="/"
                    className="text-sm text-muted hover:text-foreground transition-colors"
                  >
                    Szukaj
                  </Link>
                  <Link
                    href="/browse"
                    className="text-sm text-muted hover:text-foreground transition-colors"
                  >
                    Orzeczenia
                  </Link>
                  <Link
                    href="/history"
                    className="text-sm text-muted hover:text-foreground transition-colors"
                  >
                    Historia
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
