import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// PATCH — update custom template
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id } = await params;
  const templateId = parseInt(id, 10);
  if (isNaN(templateId)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json({ error: "Nazwa szablonu jest wymagana." }, { status: 400 });
    }
    updates.name = body.name.trim();
  }
  if (body.questions !== undefined) {
    if (!Array.isArray(body.questions) || body.questions.filter((q: string) => q.trim()).length === 0) {
      return NextResponse.json({ error: "Przynajmniej jedno pytanie jest wymagane." }, { status: 400 });
    }
    updates.questions = body.questions.filter((q: string) => q.trim());
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Brak zmian." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("user_analysis_templates")
    .update(updates)
    .eq("id", templateId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE — delete custom template
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error: authError } = await requireUser(request);
  if (authError) return authError;

  const { id } = await params;
  const templateId = parseInt(id, 10);
  if (isNaN(templateId)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("user_analysis_templates")
    .delete()
    .eq("id", templateId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
