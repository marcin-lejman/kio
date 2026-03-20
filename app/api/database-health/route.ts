import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

let cachedData: unknown = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  try {
    const now = Date.now();
    if (cachedData && now - cachedAt < CACHE_TTL_MS) {
      return NextResponse.json(cachedData, {
        headers: {
          "Cache-Control": "no-cache",
          "X-Cache": "HIT",
        },
      });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("get_database_health");

    if (error) throw error;

    cachedData = data;
    cachedAt = now;

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-cache",
        "X-Cache": "MISS",
      },
    });
  } catch (err) {
    console.error("Database health check failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch database health" },
      { status: 500 }
    );
  }
}
