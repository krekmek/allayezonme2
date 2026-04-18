-- ============================================================
-- Расширение schedules для поддержки задач техперсонала
-- ============================================================

-- Добавляем колонки для поддержки задач (по одной за раз)
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'lesson';  -- 'lesson' или 'task'
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES public.tasks(id);
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS title TEXT;                  -- Для задач: название
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS description TEXT;            -- Для задач: описание

-- Индексы для быстрого поиска задач
CREATE INDEX IF NOT EXISTS idx_schedules_type ON public.schedules(type);
CREATE INDEX IF NOT EXISTS idx_schedules_task_id ON public.schedules(task_id);

-- Для задач техперсонала class_name может быть NULL (у них нет привязки к классу)
-- lesson_number всё равно нужен для слотирования по времени
