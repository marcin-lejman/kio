import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { count, error } = await supabase
      .from("verdicts")
      .select("*", { count: "planned", head: true });

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
