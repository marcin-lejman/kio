-- RLS performance optimizations
--
-- 1. Wrap auth.uid() / auth.role() in (select ...) so PostgreSQL evaluates
--    them once per query instead of per row (initplan optimization).
-- 2. Merge the two permissive SELECT policies on profiles into one.
-- 3. Cache auth.uid() in can_access_folder() function.
-- 4. Drop unused indexes.

BEGIN;

-- ============================================================
-- search_history
-- ============================================================

DROP POLICY "Users view own history" ON search_history;
CREATE POLICY "Users view own history" ON search_history FOR SELECT
    USING ((select auth.uid()) = user_id);

DROP POLICY "Users insert own history" ON search_history;
CREATE POLICY "Users insert own history" ON search_history FOR INSERT
    WITH CHECK ((select auth.uid()) = user_id);

-- ============================================================
-- verdicts
-- ============================================================

DROP POLICY "Authenticated users read verdicts" ON verdicts;
CREATE POLICY "Authenticated users read verdicts" ON verdicts FOR SELECT
    USING ((select auth.role()) = 'authenticated');

-- ============================================================
-- chunks
-- ============================================================

DROP POLICY "Authenticated users read chunks" ON chunks;
CREATE POLICY "Authenticated users read chunks" ON chunks FOR SELECT
    USING ((select auth.role()) = 'authenticated');

-- ============================================================
-- profiles — merge two SELECT policies into one
-- ============================================================

DROP POLICY "Users read own profile" ON profiles;
DROP POLICY "Admins read all profiles" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT
    USING (
        (select auth.uid()) = id
        OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = (select auth.uid()) AND p.role = 'admin'
        )
    );

DROP POLICY "Admins update profiles" ON profiles;
CREATE POLICY "Admins update profiles" ON profiles FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = (select auth.uid()) AND p.role = 'admin'
        )
    );

-- ============================================================
-- folders
-- ============================================================

DROP POLICY "folders_select" ON folders;
CREATE POLICY "folders_select" ON folders FOR SELECT
    USING (
        owner_id = (select auth.uid())
        OR EXISTS (
            SELECT 1 FROM folder_shares
            WHERE folder_id = id AND user_id = (select auth.uid())
        )
    );

DROP POLICY "folders_insert" ON folders;
CREATE POLICY "folders_insert" ON folders FOR INSERT
    WITH CHECK (owner_id = (select auth.uid()));

DROP POLICY "folders_update" ON folders;
CREATE POLICY "folders_update" ON folders FOR UPDATE
    USING (owner_id = (select auth.uid()));

DROP POLICY "folders_delete" ON folders;
CREATE POLICY "folders_delete" ON folders FOR DELETE
    USING (owner_id = (select auth.uid()));

-- ============================================================
-- folder_notes
-- ============================================================

DROP POLICY "folder_notes_insert" ON folder_notes;
CREATE POLICY "folder_notes_insert" ON folder_notes FOR INSERT
    WITH CHECK (
        can_access_folder(folder_id, 'read_write')
        AND author_id = (select auth.uid())
    );

DROP POLICY "folder_notes_update" ON folder_notes;
CREATE POLICY "folder_notes_update" ON folder_notes FOR UPDATE
    USING (
        author_id = (select auth.uid())
        AND can_access_folder(folder_id, 'read_write')
    );

DROP POLICY "folder_notes_delete" ON folder_notes;
CREATE POLICY "folder_notes_delete" ON folder_notes FOR DELETE
    USING (
        (author_id = (select auth.uid()) AND can_access_folder(folder_id, 'read_write'))
        OR EXISTS (
            SELECT 1 FROM folders
            WHERE id = folder_id AND owner_id = (select auth.uid())
        )
    );

-- ============================================================
-- folder_shares
-- ============================================================

DROP POLICY "folder_shares_select" ON folder_shares;
CREATE POLICY "folder_shares_select" ON folder_shares FOR SELECT
    USING (
        user_id = (select auth.uid())
        OR EXISTS (
            SELECT 1 FROM folders
            WHERE id = folder_id AND owner_id = (select auth.uid())
        )
    );

DROP POLICY "folder_shares_insert" ON folder_shares;
CREATE POLICY "folder_shares_insert" ON folder_shares FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM folders
            WHERE id = folder_id AND owner_id = (select auth.uid())
        )
    );

DROP POLICY "folder_shares_update" ON folder_shares;
CREATE POLICY "folder_shares_update" ON folder_shares FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM folders
            WHERE id = folder_id AND owner_id = (select auth.uid())
        )
    );

DROP POLICY "folder_shares_delete" ON folder_shares;
CREATE POLICY "folder_shares_delete" ON folder_shares FOR DELETE
    USING (
        user_id = (select auth.uid())
        OR EXISTS (
            SELECT 1 FROM folders
            WHERE id = folder_id AND owner_id = (select auth.uid())
        )
    );

-- ============================================================
-- can_access_folder() — cache auth.uid() in local variable
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
DECLARE
    _uid UUID := auth.uid();
BEGIN
    -- Owner always has full access
    IF EXISTS (
        SELECT 1 FROM public.folders
        WHERE id = p_folder_id AND owner_id = _uid
    ) THEN
        RETURN TRUE;
    END IF;

    -- Check sharing table
    IF p_min_permission = 'read' THEN
        RETURN EXISTS (
            SELECT 1 FROM public.folder_shares
            WHERE folder_id = p_folder_id
              AND user_id = _uid
        );
    ELSIF p_min_permission = 'read_write' THEN
        RETURN EXISTS (
            SELECT 1 FROM public.folder_shares
            WHERE folder_id = p_folder_id
              AND user_id = _uid
              AND permission = 'read_write'
        );
    END IF;

    RETURN FALSE;
END;
$$;

-- ============================================================
-- Drop unused indexes
-- ============================================================

DROP INDEX IF EXISTS idx_folders_owner;        -- redundant: covered by idx_folders_owner_status
DROP INDEX IF EXISTS idx_api_cost_log_model;   -- never used in queries

COMMIT;
