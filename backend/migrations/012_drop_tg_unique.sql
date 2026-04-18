-- 012_drop_tg_unique.sql
-- Убираем уникальность telegram_id чтобы можно было тестировать с одним аккаунтом,
-- и переводим все фейковые ID (seed data 1001-2000) на реальный аккаунт пользователя.

ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_telegram_id_key;

-- Обычный индекс (не unique) для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_staff_telegram_id ON public.staff (telegram_id);

-- Переводим всех учителей с фейковыми ID на реальный Telegram пользователя
UPDATE public.staff
SET telegram_id = 6343039871
WHERE telegram_id < 100000;
