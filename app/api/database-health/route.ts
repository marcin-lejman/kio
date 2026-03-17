import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function GET() {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("get_database_health");

    if (error) throw error;

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-cache",
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
