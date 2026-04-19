-- 028_disable_tasks_rls.sql
-- Отключение RLS на таблице tasks для разрешения изменения статусов всеми участниками

ALTER TABLE public.tasks DISABLE ROW LEVEL SECURITY;
