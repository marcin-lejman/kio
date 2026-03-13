import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function GET() {
  try {
    const supabase = createServerClient();
    const { count, error } = await supabase
      .from("verdicts")
      .select("*", { count: "exact", head: true });

    if (error) throw error;

    return NextResponse.json(
      { verdict_count: count ?? 0 },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      }
    );
  } catch {
    return NextResponse.json({ verdict_count: 0 }, { status: 500 });
  }
}
