const OPENROUTER_API_KEY = () => process.env.OPENROUTER_API_KEY!;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
}

// Models used in the pipeline
export const MODELS = {
  // Layer 1: Query understanding (fast + cheap)
  QUERY_UNDERSTANDING: "google/gemini-3.1-flash-lite-preview",
  // Layer 3: Answer generation options
  ANSWER_GENERATION: "anthropic/claude-sonnet-4.6",
  ANSWER_GENERATION_FAST: "google/gemini-3.1-flash-lite-preview",
  ANSWER_GENERATION_PRO: "google/gemini-3.1-pro-preview",
  // Embeddings
  EMBEDDING: "openai/text-embedding-3-large",
} as const;

export const ANSWER_MODELS = [
  { id: MODELS.ANSWER_GENERATION, label: "Claude Sonnet 4.6" },
  { id: MODELS.ANSWER_GENERATION_FAST, label: "Gemini Flash Lite" },
  { id: MODELS.ANSWER_GENERATION_PRO, label: "Gemini Pro" },
] as const;

export async function chatCompletion(
  messages: ChatMessage[],
  model: string,
  options?: { temperature?: number; max_tokens?: number }
): Promise<LLMResponse> {
  const start = Date.now();

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://uzp-search.vercel.app",
      "X-Title": "UZP KIO Search",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.max_tokens ?? 2048,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const latency_ms = Date.now() - start;
  const usage = data.usage || {};

  return {
    content: data.choices[0]?.message?.content || "",
    model: data.model || model,
    input_tokens: usage.prompt_tokens || 0,
    output_tokens: usage.completion_tokens || 0,
    cost_usd: parseFloat(data.usage?.total_cost || "0") || estimateCost(model, usage.prompt_tokens || 0, usage.completion_tokens || 0),
    latency_ms,
  };
}

export async function chatCompletionStream(
  messages: ChatMessage[],
  model: string,
  options?: { temperature?: number; max_tokens?: number }
): Promise<{ stream: ReadableStream<Uint8Array>; startTime: number }> {
  const startTime = Date.now();

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://uzp-search.vercel.app",
      "X-Title": "UZP KIO Search",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.max_tokens ?? 2048,
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${error}`);
  }

  return { stream: response.body!, startTime };
}

export async function embedText(text: string): Promise<{ embedding: number[]; tokens: number; cost_usd: number; latency_ms: number }> {
  const start = Date.now();

  const response = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODELS.EMBEDDING,
      input: text,
      dimensions: 3072,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const latency_ms = Date.now() - start;

  return {
    embedding: data.data[0].embedding,
    tokens: data.usage?.total_tokens || 0,
    cost_usd: estimateCost(MODELS.EMBEDDING, data.usage?.total_tokens || 0, 0),
    latency_ms,
  };
}

// Rough cost estimates per model (per 1M tokens)
const COST_TABLE: Record<string, { input: number; output: number }> = {
  "google/gemini-2.0-flash-001": { input: 0.1, output: 0.4 },
  "google/gemini-3.1-flash-lite-preview": { input: 0.02, output: 0.08 },
  "google/gemini-3.1-pro-preview": { input: 1.25, output: 10.0 },
  "anthropic/claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "anthropic/claude-sonnet-4.6": { input: 3.0, output: 15.0 },
  "openai/text-embedding-3-large": { input: 0.13, output: 0 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_TABLE[model] || { input: 1, output: 3 };
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}
