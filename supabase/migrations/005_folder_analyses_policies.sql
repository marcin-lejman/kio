-- Add missing UPDATE and DELETE RLS policies for folder_analyses
CREATE POLICY "folder_analyses_update" ON folder_analyses FOR UPDATE
    USING (can_access_folder(folder_id, 'read_write'));

CREATE POLICY "folder_analyses_delete" ON folder_analyses FOR DELETE
    USING (can_access_folder(folder_id, 'read_write'));
