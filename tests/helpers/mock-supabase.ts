import { vi } from "vitest";

/**
 * Chainable mock that mimics the Supabase query builder pattern:
 *   supabase.from("table").select("*").eq("col", val).single()
 *
 * Configure the final return value via `mockResult()` before the chain is consumed.
 */
export function createMockQueryBuilder(result: { data: unknown; error: unknown; count?: number | null } = { data: null, error: null }) {
  const builder: Record<string, unknown> = {};
  const chainMethods = [
    "select", "insert", "update", "delete", "upsert",
    "eq", "neq", "in", "is", "gt", "gte", "lt", "lte", "like", "ilike",
    "order", "limit", "range", "single", "maybeSingle",
    "filter", "not", "or", "match",
  ];

  for (const method of chainMethods) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }

  // Terminal methods that return the result
  builder.then = undefined; // Make it thenable
  // Override: when the chain is awaited, return the result
  const promiseLike = Object.assign(builder, {
    then: (resolve: (value: unknown) => void) => resolve(result),
  });

  return promiseLike;
}

/**
 * Creates a mock Supabase client with a `.from()` method.
 *
 * Usage:
 *   const { supabase, mockTable } = createMockSupabase();
 *   mockTable("folders", { data: [...], error: null });
 *
 * Each call to `mockTable` sets the result for the next query on that table.
 */
export function createMockSupabase() {
  const tableResults = new Map<string, Array<{ data: unknown; error: unknown; count?: number | null }>>();
  const tableCallIndex = new Map<string, number>();

  function mockTable(table: string, result: { data: unknown; error: unknown; count?: number | null }) {
    if (!tableResults.has(table)) {
      tableResults.set(table, []);
    }
    tableResults.get(table)!.push(result);
  }

  const from = vi.fn((table: string) => {
    const results = tableResults.get(table) || [];
    const idx = tableCallIndex.get(table) || 0;
    const result = results[idx] || { data: null, error: null };
    tableCallIndex.set(table, idx + 1);
    return createMockQueryBuilder(result);
  });

  const supabase = { from, auth: { admin: {} } };

  function reset() {
    tableResults.clear();
    tableCallIndex.clear();
    from.mockClear();
  }

  return { supabase, mockTable, from, reset };
}

/**
 * Mock a specific user for auth. Call before the test.
 */
export function mockUser(userId: string = "user-1") {
  return {
    id: userId,
    email: `${userId}@test.com`,
    app_metadata: { role: "regular" },
    user_metadata: {},
    aud: "authenticated",
    created_at: "2024-01-01T00:00:00Z",
  };
}
