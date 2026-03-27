-- Follow-up conversation messages for AI overview
CREATE TABLE public.search_conversations (
    id            SERIAL PRIMARY KEY,
    search_id     INTEGER NOT NULL REFERENCES search_history(id) ON DELETE CASCADE,
    ordinal       INTEGER NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content       TEXT NOT NULL,
    input_tokens  INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost_usd      NUMERIC(10,6) DEFAULT 0,
    latency_ms    INTEGER DEFAULT 0,
    model         TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(search_id, ordinal)
);

CREATE INDEX idx_search_conversations_search ON search_conversations(search_id);

-- RLS: allow service role full access (matches existing pattern for search_history/api_cost_log)
ALTER TABLE public.search_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.search_conversations
    FOR ALL USING (true) WITH CHECK (true);

-- Atomic increment for search_history cost/token totals after follow-up messages
CREATE OR REPLACE FUNCTION public.increment_search_costs(
    p_search_id INTEGER,
    p_tokens INTEGER,
    p_cost NUMERIC
) RETURNS void AS $$
BEGIN
    UPDATE search_history
    SET tokens_used = COALESCE(tokens_used, 0) + p_tokens,
        cost_usd = COALESCE(cost_usd, 0) + p_cost
    WHERE id = p_search_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
