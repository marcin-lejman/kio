-- User-defined analysis templates (reusable across folders)
CREATE TABLE public.user_analysis_templates (
    id              SERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    questions       TEXT[] NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_analysis_templates_user ON user_analysis_templates(user_id);

ALTER TABLE user_analysis_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_templates" ON user_analysis_templates FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "users_insert_own_templates" ON user_analysis_templates FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "users_update_own_templates" ON user_analysis_templates FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "users_delete_own_templates" ON user_analysis_templates FOR DELETE
    USING (user_id = auth.uid());

CREATE TRIGGER user_analysis_templates_updated_at
    BEFORE UPDATE ON user_analysis_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
