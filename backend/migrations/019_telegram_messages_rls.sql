-- ============================================================
-- RLS для telegram_messages: отключаем для публичной витрины
-- ============================================================

ALTER TABLE public.telegram_messages DISABLE ROW LEVEL SECURITY;
