-- Таблица очков оперативности учителей
CREATE TABLE IF NOT EXISTS public.teacher_points (
    id BIGSERIAL PRIMARY KEY,
    staff_id BIGINT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    reports_before_09_count INTEGER NOT NULL DEFAULT 0,
    last_report_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Уникальный constraint на staff_id
ALTER TABLE public.teacher_points ADD CONSTRAINT teacher_points_staff_id_key UNIQUE (staff_id);

-- Индекс для быстрого поиска топ учителей
CREATE INDEX IF NOT EXISTS teacher_points_points_idx ON public.teacher_points (points DESC);

-- Внешний ключ к staff
ALTER TABLE public.teacher_points ADD CONSTRAINT teacher_points_staff_id_fkey 
    FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;
