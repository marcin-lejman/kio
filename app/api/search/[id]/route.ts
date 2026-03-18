import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const searchId = parseInt(id, 10);

  if (isNaN(searchId)) {
    return new Response(JSON.stringify({ error: "Invalid search ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("search_history")
    .select("id, query, filters, ai_answer, ai_status, answer_model, result_data, created_at")
    .eq("id", searchId)
    .single();

  if (error || !data) {
    return new Response(JSON.stringify({ error: "Search not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}
