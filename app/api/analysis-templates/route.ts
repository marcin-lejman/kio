import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";

// GET — list user's custom templates
export async function GET(request: NextRequest) {
  const limited = rateLimit(request, { maxRequests: 30, windowMs: 60_000, prefix: "analysis-templates" });
  if (limited) return limited;

  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const supabase = createAdminClient();
  const { data: templates, error } = await supabase
    .from("user_analysis_templates")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ templates: templates || [] });
}

// POST — create custom template
export async function POST(request: NextRequest) {
  const limited = rateLimit(request, { maxRequests: 10, windowMs: 60_000, prefix: "analysis-templates-create" });
  if (limited) return limited;

  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const body = await request.json();
  const { name, questions } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Nazwa szablonu jest wymagana." }, { status: 400 });
  }
  if (!Array.isArray(questions) || questions.filter((q: string) => q.trim()).length === 0) {
    return NextResponse.json({ error: "Przynajmniej jedno pytanie jest wymagane." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: template, error } = await supabase
    .from("user_analysis_templates")
    .insert({
      user_id: user.id,
      name: name.trim(),
      questions: questions.filter((q: string) => q.trim()),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(template, { status: 201 });
}
