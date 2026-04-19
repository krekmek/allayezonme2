-- 026_disable_schedules_rls.sql
-- Отключаем RLS на таблице schedules для генерации расписания

ALTER TABLE public.schedules DISABLE ROW LEVEL SECURITY;
