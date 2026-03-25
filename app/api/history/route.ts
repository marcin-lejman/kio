import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, { maxRequests: 30, windowMs: 60_000, prefix: "history" });
  if (limited) return limited;
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  try {
    const supabase = createAdminClient();

    const { data, error, count } = await supabase
      .from("search_history")
      .select("id, user_id, query, result_count, ai_status, answer_model, tokens_used, cost_usd, latency_ms, created_at, result_data->search_mode", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // Resolve user emails from profiles
    const userIds = [...new Set((data || []).map((d) => d.user_id).filter(Boolean))];
    let emailMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", userIds);
      emailMap = Object.fromEntries(
        (profiles || []).map((p) => [p.id, p.email])
      );
    }

    const history = (data || []).map((entry) => ({
      ...entry,
      user_email: entry.user_id ? emailMap[entry.user_id] || null : null,
    }));

    return NextResponse.json({
      history,
      total: count || 0,
    });
  } catch (error) {
    console.error("History fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch history" },
      { status: 500 }
    );
  }
}
