import { NextRequest } from "next/server";

/**
 * Create a NextRequest for testing API routes.
 */
export function createRequest(
  method: string,
  path: string,
  options: {
    body?: unknown;
    searchParams?: Record<string, string>;
  } = {}
): NextRequest {
  const url = new URL(path, "http://localhost:3000");
  if (options.searchParams) {
    for (const [key, value] of Object.entries(options.searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const init: Record<string, unknown> = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  if (options.body && method !== "GET") {
    init.body = JSON.stringify(options.body);
  }

  return new NextRequest(url, init as never);
}

/**
 * Parse a NextResponse JSON body.
 */
export async function parseResponse(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = await response.json();
  return { status: response.status, body };
}
