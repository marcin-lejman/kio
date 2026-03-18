import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;

  const limited = rateLimit(request, { maxRequests: 30, windowMs: 60_000, prefix: "costs" });
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "30", 10);

  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase.rpc("get_cost_summary", {
      from_date: new Date(Date.now() - days * 86400000).toISOString().split("T")[0],
      to_date: new Date().toISOString().split("T")[0],
    });

    if (error) throw error;

    // Also get totals
    const { data: totals, error: totalsError } = await supabase
      .from("api_cost_log")
      .select("cost_usd")
      .gte("created_at", new Date(Date.now() - days * 86400000).toISOString());

    if (totalsError) throw totalsError;

    const totalCost = (totals || []).reduce((sum, row) => sum + parseFloat(row.cost_usd || "0"), 0);
    const totalCalls = (totals || []).length;

    return NextResponse.json({
      daily: data || [],
      summary: {
        total_cost_usd: totalCost,
        total_calls: totalCalls,
        period_days: days,
      },
    });
  } catch (error) {
    console.error("Costs fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch costs" },
      { status: 500 }
    );
  }
}
