import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";

const ALLOWED_SORT_FIELDS = ["verdict_date", "sygnatura"] as const;
const ALLOWED_ORDERS = ["asc", "desc"] as const;
const MAX_PER_PAGE = 100;

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, {
    maxRequests: 60,
    windowMs: 60_000,
    prefix: "browse",
  });
  if (limited) return limited;

  const params = request.nextUrl.searchParams;

  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, parseInt(params.get("per_page") || "25", 10) || 25)
  );
  const sort = ALLOWED_SORT_FIELDS.includes(
    params.get("sort") as (typeof ALLOWED_SORT_FIELDS)[number]
  )
    ? (params.get("sort") as string)
    : "verdict_date";
  const order = ALLOWED_ORDERS.includes(
    params.get("order") as (typeof ALLOWED_ORDERS)[number]
  )
    ? (params.get("order") as string)
    : "desc";

  const sygnatura = params.get("sygnatura")?.trim() || null;
  const documentType = params.get("document_type")?.trim() || null;
  const decisionType = params.get("decision_type")?.trim() || null;
  const dateFrom = params.get("date_from")?.trim() || null;
  const dateTo = params.get("date_to")?.trim() || null;
  const chairman = params.get("chairman")?.trim() || null;
  const contractingAuthority =
    params.get("contracting_authority")?.trim() || null;

  try {
    const supabase = createServerClient();

    let query = supabase
      .from("verdicts")
      .select(
        "id, sygnatura, verdict_date, document_type, document_type_normalized, decision_type, decision_type_normalized, metadata_json",
        { count: "exact" }
      );

    if (sygnatura) {
      query = query.ilike("sygnatura", `%${sygnatura}%`);
    }
    if (documentType) {
      query = query.eq("document_type_normalized", documentType);
    }
    if (decisionType) {
      query = query.eq("decision_type_normalized", decisionType);
    }
    if (dateFrom) {
      query = query.gte("verdict_date", dateFrom);
    }
    if (dateTo) {
      query = query.lte("verdict_date", dateTo);
    }
    if (chairman) {
      query = query.ilike("metadata_json->>chairman", `%${chairman}%`);
    }
    if (contractingAuthority) {
      query = query.ilike(
        "metadata_json->>contracting_authority",
        `%${contractingAuthority}%`
      );
    }

    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    query = query.order(sort, { ascending: order === "asc" }).range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error("Browse query error:", error);
      return NextResponse.json(
        { error: "Database query failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      verdicts: data || [],
      total: count || 0,
      page,
      per_page: perPage,
    });
  } catch (err) {
    console.error("Browse endpoint error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
