import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";

const DEFAULT_TEMPLATES = [
  {
    name: "Porównaj linie orzecznicze",
    questions: [
      "Jak różnią się stanowiska KIO w analizowanych orzeczeniach?",
      "Czy można zidentyfikować dominujący pogląd?",
      "Jak stanowiska zmieniały się w czasie?",
    ],
  },
  {
    name: "Znajdź sprzeczności",
    questions: [
      "Czy w analizowanych orzeczeniach występują sprzeczne tezy prawne?",
      "Jakie są kluczowe różnice w argumentacji Izby?",
    ],
  },
  {
    name: "Wspólne podstawy prawne",
    questions: [
      "Jakie przepisy są powoływane w analizowanych orzeczeniach?",
      "Które podstawy prawne są wspólne dla wszystkich orzeczeń?",
    ],
  },
  {
    name: "Podsumuj dla klienta",
    questions: [
      "Jakie są główne wnioski z analizowanych orzeczeń?",
      "Co te orzeczenia oznaczają w praktyce dla zamawiającego i wykonawcy?",
    ],
  },
];

// GET — list user's templates (seeds defaults on first access)
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
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Seed defaults on first access (no templates yet)
  if (!templates || templates.length === 0) {
    const rows = DEFAULT_TEMPLATES.map((t) => ({
      user_id: user.id,
      name: t.name,
      questions: t.questions,
    }));
    const { data: seeded, error: seedError } = await supabase
      .from("user_analysis_templates")
      .insert(rows)
      .select();

    if (seedError) {
      return NextResponse.json({ error: seedError.message }, { status: 500 });
    }

    return NextResponse.json({ templates: seeded || [] });
  }

  return NextResponse.json({ templates });
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
