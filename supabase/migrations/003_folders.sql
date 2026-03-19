-- Teczki projektowe (Project Dossiers)
-- All tables deployed upfront for schema coherence.
-- Phase 1: folders, folder_items, folder_notes
-- Phase 2: folder_shares, folder_tags, folder_item_tags, folder_search_entries, folder_saved_queries
-- Phase 3: folder_analyses

-- ============================================================
-- 1. Core tables
-- ============================================================

CREATE TABLE public.folders (
    id              SERIAL PRIMARY KEY,
    owner_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
    item_count      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_folders_owner ON folders(owner_id);
CREATE INDEX idx_folders_owner_status ON folders(owner_id, is_archived);

-- ============================================================
-- 2. Folder sharing (Phase 2, table created now)
-- ============================================================

CREATE TABLE public.folder_shares (
    id              SERIAL PRIMARY KEY,
    folder_id       INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    permission      TEXT NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'read_write')),
    granted_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(folder_id, user_id)
);

CREATE INDEX idx_folder_shares_user ON folder_shares(user_id);
CREATE INDEX idx_folder_shares_folder ON folder_shares(folder_id);

-- ============================================================
-- 3. Search entries (Phase 2, created now for FK from folder_items)
-- ============================================================

CREATE TABLE public.folder_search_entries (
    id              SERIAL PRIMARY KEY,
    folder_id       INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    search_id       INTEGER REFERENCES search_history(id) ON DELETE SET NULL,
    query           TEXT NOT NULL,
    ai_overview     TEXT,
    filters         JSONB,
    result_count    INTEGER,
    added_by        UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_folder_search_entries_folder ON folder_search_entries(folder_id);

-- ============================================================
-- 4. Folder items (verdicts in folders)
-- ============================================================

CREATE TABLE public.folder_items (
    id                SERIAL PRIMARY KEY,
    folder_id         INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    verdict_id        INTEGER NOT NULL REFERENCES verdicts(id) ON DELETE CASCADE,
    position          INTEGER NOT NULL DEFAULT 0,
    added_from        TEXT,
    search_entry_id   INTEGER REFERENCES folder_search_entries(id) ON DELETE SET NULL,
    added_by          UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(folder_id, verdict_id)
);

CREATE INDEX idx_folder_items_folder ON folder_items(folder_id, position);
CREATE INDEX idx_folder_items_verdict ON folder_items(verdict_id);

-- ============================================================
-- 5. Notes (per-item or folder-level discussion)
-- ============================================================

CREATE TABLE public.folder_notes (
    id              SERIAL PRIMARY KEY,
    folder_id       INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    item_id         INTEGER REFERENCES folder_items(id) ON DELETE CASCADE,
    author_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_folder_notes_folder ON folder_notes(folder_id);
CREATE INDEX idx_folder_notes_item ON folder_notes(item_id) WHERE item_id IS NOT NULL;
CREATE INDEX idx_folder_notes_discussion ON folder_notes(folder_id, created_at) WHERE item_id IS NULL;

-- ============================================================
-- 6. Tags (Phase 2)
-- ============================================================

CREATE TABLE public.folder_tags (
    id              SERIAL PRIMARY KEY,
    folder_id       INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    color           TEXT NOT NULL DEFAULT '#6b7280',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(folder_id, name)
);

CREATE INDEX idx_folder_tags_folder ON folder_tags(folder_id);

CREATE TABLE public.folder_item_tags (
    item_id         INTEGER NOT NULL REFERENCES folder_items(id) ON DELETE CASCADE,
    tag_id          INTEGER NOT NULL REFERENCES folder_tags(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (item_id, tag_id)
);

CREATE INDEX idx_folder_item_tags_tag ON folder_item_tags(tag_id);

-- ============================================================
-- 7. Saved queries (Phase 2)
-- ============================================================

CREATE TABLE public.folder_saved_queries (
    id              SERIAL PRIMARY KEY,
    folder_id       INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    search_id       INTEGER REFERENCES search_history(id) ON DELETE SET NULL,
    label           TEXT,
    query_text      TEXT NOT NULL,
    filters         JSONB,
    added_by        UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_folder_saved_queries_folder ON folder_saved_queries(folder_id);

-- ============================================================
-- 8. AI analyses (Phase 3)
-- ============================================================

CREATE TABLE public.folder_analyses (
    id              SERIAL PRIMARY KEY,
    folder_id       INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    questions       TEXT[] NOT NULL,
    template        TEXT,
    verdict_ids     INTEGER[] NOT NULL,
    result          TEXT,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'error')),
    model           TEXT,
    tokens_used     INTEGER,
    cost_usd        NUMERIC(10,6),
    error_message   TEXT,
    created_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_folder_analyses_folder ON folder_analyses(folder_id, created_at DESC);

-- ============================================================
-- 9. RLS helper function
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_access_folder(
    p_folder_id INTEGER,
    p_min_permission TEXT DEFAULT 'read'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Owner always has full access
    IF EXISTS (
        SELECT 1 FROM public.folders
        WHERE id = p_folder_id AND owner_id = auth.uid()
    ) THEN
        RETURN TRUE;
    END IF;

    -- Check sharing table
    IF p_min_permission = 'read' THEN
        RETURN EXISTS (
            SELECT 1 FROM public.folder_shares
            WHERE folder_id = p_folder_id
              AND user_id = auth.uid()
        );
    ELSIF p_min_permission = 'read_write' THEN
        RETURN EXISTS (
            SELECT 1 FROM public.folder_shares
            WHERE folder_id = p_folder_id
              AND user_id = auth.uid()
              AND permission = 'read_write'
        );
    END IF;

    RETURN FALSE;
END;
$$;

-- ============================================================
-- 10. RLS policies
-- ============================================================

-- folders
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "folders_select" ON folders FOR SELECT
    USING (owner_id = auth.uid() OR EXISTS (
        SELECT 1 FROM folder_shares WHERE folder_id = id AND user_id = auth.uid()
    ));

CREATE POLICY "folders_insert" ON folders FOR INSERT
    WITH CHECK (owner_id = auth.uid());

CREATE POLICY "folders_update" ON folders FOR UPDATE
    USING (owner_id = auth.uid());

CREATE POLICY "folders_delete" ON folders FOR DELETE
    USING (owner_id = auth.uid());

-- folder_items
ALTER TABLE folder_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "folder_items_select" ON folder_items FOR SELECT
    USING (can_access_folder(folder_id, 'read'));

CREATE POLICY "folder_items_insert" ON folder_items FOR INSERT
    WITH CHECK (can_access_folder(folder_id, 'read_write'));

CREATE POLICY "folder_items_update" ON folder_items FOR UPDATE
    USING (can_access_folder(folder_id, 'read_write'));

CREATE POLICY "folder_items_delete" ON folder_items FOR DELETE
    USING (can_access_folder(folder_id, 'read_write'));

-- folder_notes
ALTER TABLE folder_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "folder_notes_select" ON folder_notes FOR SELECT
    USING (can_access_folder(folder_id, 'read'));

CREATE POLICY "folder_notes_insert" ON folder_notes FOR INSERT
    WITH CHECK (can_access_folder(folder_id, 'read_write') AND author_id = auth.uid());

CREATE POLICY "folder_notes_update" ON folder_notes FOR UPDATE
    USING (author_id = auth.uid() AND can_access_folder(folder_id, 'read_write'));

CREATE POLICY "folder_notes_delete" ON folder_notes FOR DELETE
    USING (
        (author_id = auth.uid() AND can_access_folder(folder_id, 'read_write'))
        OR EXISTS (SELECT 1 FROM folders WHERE id = folder_id AND owner_id = auth.uid())
    );

-- folder_shares
ALTER TABLE folder_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "folder_shares_select" ON folder_shares FOR SELECT
    USING (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM folders WHERE id = folder_id AND owner_id = auth.uid())
    );

CREATE POLICY "folder_shares_insert" ON folder_shares FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM folders WHERE id = folder_id AND owner_id = auth.uid()));

CREATE POLICY "folder_shares_update" ON folder_shares FOR UPDATE
    USING (EXISTS (SELECT 1 FROM folders WHERE id = folder_id AND owner_id = auth.uid()));

CREATE POLICY "folder_shares_delete" ON folder_shares FOR DELETE
    USING (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM folders WHERE id = folder_id AND owner_id = auth.uid())
    );

-- folder_tags
ALTER TABLE folder_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "folder_tags_select" ON folder_tags FOR SELECT
    USING (can_access_folder(folder_id, 'read'));

CREATE POLICY "folder_tags_insert" ON folder_tags FOR INSERT
    WITH CHECK (can_access_folder(folder_id, 'read_write'));

CREATE POLICY "folder_tags_update" ON folder_tags FOR UPDATE
    USING (can_access_folder(folder_id, 'read_write'));

CREATE POLICY "folder_tags_delete" ON folder_tags FOR DELETE
    USING (can_access_folder(folder_id, 'read_write'));

-- folder_item_tags
ALTER TABLE folder_item_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "folder_item_tags_select" ON folder_item_tags FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM folder_items fi WHERE fi.id = item_id AND can_access_folder(fi.folder_id, 'read')
    ));

CREATE POLICY "folder_item_tags_insert" ON folder_item_tags FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM folder_items fi WHERE fi.id = item_id AND can_access_folder(fi.folder_id, 'read_write')
    ));

CREATE POLICY "folder_item_tags_delete" ON folder_item_tags FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM folder_items fi WHERE fi.id = item_id AND can_access_folder(fi.folder_id, 'read_write')
    ));

-- folder_search_entries
ALTER TABLE folder_search_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "folder_search_entries_select" ON folder_search_entries FOR SELECT
    USING (can_access_folder(folder_id, 'read'));

CREATE POLICY "folder_search_entries_insert" ON folder_search_entries FOR INSERT
    WITH CHECK (can_access_folder(folder_id, 'read_write'));

-- folder_saved_queries
ALTER TABLE folder_saved_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "folder_saved_queries_select" ON folder_saved_queries FOR SELECT
    USING (can_access_folder(folder_id, 'read'));

CREATE POLICY "folder_saved_queries_insert" ON folder_saved_queries FOR INSERT
    WITH CHECK (can_access_folder(folder_id, 'read_write'));

CREATE POLICY "folder_saved_queries_delete" ON folder_saved_queries FOR DELETE
    USING (can_access_folder(folder_id, 'read_write'));

-- folder_analyses
ALTER TABLE folder_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "folder_analyses_select" ON folder_analyses FOR SELECT
    USING (can_access_folder(folder_id, 'read'));

CREATE POLICY "folder_analyses_insert" ON folder_analyses FOR INSERT
    WITH CHECK (can_access_folder(folder_id, 'read_write'));

-- ============================================================
-- 11. Triggers
-- ============================================================

-- Reuse update_updated_at() from schema.sql for folders and folder_notes
CREATE TRIGGER folders_updated_at
    BEFORE UPDATE ON folders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER folder_notes_updated_at
    BEFORE UPDATE ON folder_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Maintain denormalized item_count on folders
CREATE OR REPLACE FUNCTION public.update_folder_item_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.folders SET item_count = item_count + 1 WHERE id = NEW.folder_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.folders SET item_count = item_count - 1 WHERE id = OLD.folder_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER folder_items_count_insert
    AFTER INSERT ON folder_items
    FOR EACH ROW EXECUTE FUNCTION update_folder_item_count();

CREATE TRIGGER folder_items_count_delete
    AFTER DELETE ON folder_items
    FOR EACH ROW EXECUTE FUNCTION update_folder_item_count();
