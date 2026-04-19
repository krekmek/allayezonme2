-- 025_add_band_name_to_schedules.sql
-- Добавляем поле band_name для поддержки лент (bands)

ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS band_name TEXT;

-- Создаем индекс для быстрого поиска по лентам
CREATE INDEX IF NOT EXISTS idx_schedules_band_name ON public.schedules(band_name);
