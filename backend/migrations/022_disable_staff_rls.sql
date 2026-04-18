-- 022_disable_staff_rls.sql
-- Отключаем RLS на таблице staff, так как backend использует service role
-- и должен иметь полный доступ для создания/обновления сотрудников

ALTER TABLE public.staff DISABLE ROW LEVEL SECURITY;
