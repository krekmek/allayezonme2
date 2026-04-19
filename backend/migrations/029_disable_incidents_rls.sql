-- Отключение RLS на таблице incidents
-- Позволяет всем участникам создавать инциденты без ограничений

ALTER TABLE public.incidents DISABLE ROW LEVEL SECURITY;
