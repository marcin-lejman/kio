import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, {
    maxRequests: 60,
    windowMs: 60_000,
    prefix: "by-sygnatura",
  });
  if (limited) return limited;

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json(
      { error: "Missing q parameter" },
      { status: 400 }
    );
  }

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("verdicts")
      .select("id, sygnatura")
      .ilike("sygnatura", `%${q}%`);

    if (error) {
      console.error("by-sygnatura query error:", error);
      return NextResponse.json(
        { error: "Database query failed" },
        { status: 500 }
      );
    }

    // Normalize the query for exact matching: strip "KIO ", lowercase, collapse spaces
    const normalize = (s: string) =>
      s
        .replace(/^KIO\s+/i, "")
        .replace(/\s*\/\s*/, "/")
        .trim()
        .toLowerCase();

    const normalizedQuery = normalize(q);

    // Post-filter: compound sygnatury are separated by " | "
    const match = (data || []).find((row) =>
      row.sygnatura
        .split(" | ")
        .some((part: string) => normalize(part) === normalizedQuery)
    );

    if (match) {
      return NextResponse.json({
        found: true,
        verdict_id: match.id,
        sygnatura: match.sygnatura,
      });
    }

    return NextResponse.json({ found: false });
  } catch (err) {
    console.error("by-sygnatura endpoint error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
