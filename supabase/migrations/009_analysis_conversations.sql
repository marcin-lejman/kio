-- Follow-up conversation messages for folder analyses
CREATE TABLE public.analysis_conversations (
    id            SERIAL PRIMARY KEY,
    analysis_id   INTEGER NOT NULL REFERENCES folder_analyses(id) ON DELETE CASCADE,
    ordinal       INTEGER NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content       TEXT NOT NULL,
    input_tokens  INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost_usd      NUMERIC(10,6) DEFAULT 0,
    latency_ms    INTEGER DEFAULT 0,
    model         TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(analysis_id, ordinal)
);

CREATE INDEX idx_analysis_conversations_analysis ON analysis_conversations(analysis_id);

ALTER TABLE public.analysis_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.analysis_conversations
    FOR ALL USING (true) WITH CHECK (true);

-- Store analysis context for follow-up conversations
ALTER TABLE public.folder_analyses ADD COLUMN IF NOT EXISTS analysis_context TEXT;

-- Atomic increment for folder_analyses cost/token totals after follow-up messages
CREATE OR REPLACE FUNCTION public.increment_analysis_costs(
    p_analysis_id INTEGER,
    p_tokens INTEGER,
    p_cost NUMERIC
) RETURNS void AS $$
BEGIN
    UPDATE folder_analyses
    SET tokens_used = COALESCE(tokens_used, 0) + p_tokens,
        cost_usd = COALESCE(cost_usd, 0) + p_cost
    WHERE id = p_analysis_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
