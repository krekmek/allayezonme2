-- 027_disable_substitutions_rls.sql
-- Отключение RLS на таблице substitutions для разрешения вставок из API

ALTER TABLE public.substitutions DISABLE ROW LEVEL SECURITY;
