-- 015_staff_schedule.sql
-- Единая система штата и персональных графиков:
--   1) Расширение staff: category, weekly_load, max_load
--   2) Таблица classes (список классов + классный руководитель)
--   3) Таблица master_schedule (универсальное расписание — уроки + дежурства)
--   4) Триггер автоматического пересчёта weekly_load

-- ============================================================
-- 1. staff: категория, нагрузка
-- ============================================================
ALTER TABLE public.staff
    ADD COLUMN IF NOT EXISTS category    TEXT,   -- 'admin' | 'teacher' | 'maintenance' | 'kitchen'
    ADD COLUMN IF NOT EXISTS weekly_load INT     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_load    INT     NOT NULL DEFAULT 24;

CREATE INDEX IF NOT EXISTS idx_staff_category ON public.staff (category);

-- Подтянем category из role для уже существующих записей
UPDATE public.staff SET category =
    CASE
        WHEN role IN ('director', 'admin', 'vice_director') THEN 'admin'
        WHEN role = 'teacher'                                THEN 'teacher'
        WHEN role IN ('maintenance', 'janitor', 'handyman')  THEN 'maintenance'
        WHEN role IN ('kitchen', 'cafeteria', 'cook')        THEN 'kitchen'
        ELSE COALESCE(category, 'teacher')
    END
WHERE category IS NULL;

-- ============================================================
-- 2. classes: список классов + классный руководитель
-- ============================================================
CREATE TABLE IF NOT EXISTS public.classes (
    id                   BIGSERIAL PRIMARY KEY,
    name                 TEXT NOT NULL UNIQUE,          -- '1А', '5А', '11Б' и т.д.
    homeroom_teacher_id  BIGINT REFERENCES public.staff (id) ON DELETE SET NULL,
    students_count       INT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_classes_homeroom ON public.classes (homeroom_teacher_id);

-- ============================================================
-- 3. master_schedule: универсальное расписание для ЛЮБОГО сотрудника
--    (уроки, дежурства, обходы, дежурство в столовой и т.д.)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.master_schedule (
    id               BIGSERIAL PRIMARY KEY,
    staff_id         BIGINT NOT NULL REFERENCES public.staff (id) ON DELETE CASCADE,
    day_of_week      SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    time_slot        INT      NOT NULL CHECK (time_slot BETWEEN 1 AND 12),
    location         TEXT,            -- кабинет или зона ответственности ('201', 'столовая', 'территория')
    task_description TEXT NOT NULL,   -- 'Урок математики', 'Обход территории', 'Дежурство в столовой'
    task_type        TEXT NOT NULL DEFAULT 'lesson'
                     CHECK (task_type IN ('lesson', 'duty', 'guard', 'cafeteria', 'admin', 'maintenance')),
    class_name       TEXT,            -- если урок — имя класса
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (staff_id, day_of_week, time_slot)
);

CREATE INDEX IF NOT EXISTS idx_ms_staff      ON public.master_schedule (staff_id);
CREATE INDEX IF NOT EXISTS idx_ms_day_slot   ON public.master_schedule (day_of_week, time_slot);
CREATE INDEX IF NOT EXISTS idx_ms_task_type  ON public.master_schedule (task_type);

-- ============================================================
-- 4. Триггер пересчёта weekly_load
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalc_weekly_load(sid BIGINT)
RETURNS VOID AS $$
BEGIN
    UPDATE public.staff
    SET weekly_load = COALESCE(
        (SELECT count(*) FROM public.master_schedule WHERE staff_id = sid),
        0
    )
    WHERE id = sid;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.trg_master_schedule_weekly_load()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.recalc_weekly_load(OLD.staff_id);
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM public.recalc_weekly_load(NEW.staff_id);
        IF OLD.staff_id IS DISTINCT FROM NEW.staff_id THEN
            PERFORM public.recalc_weekly_load(OLD.staff_id);
        END IF;
        RETURN NEW;
    ELSE
        PERFORM public.recalc_weekly_load(NEW.staff_id);
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_master_schedule_load ON public.master_schedule;
CREATE TRIGGER trg_master_schedule_load
AFTER INSERT OR UPDATE OR DELETE ON public.master_schedule
FOR EACH ROW EXECUTE FUNCTION public.trg_master_schedule_weekly_load();

-- Пересчитать нагрузку для всех существующих записей (на случай повторного запуска)
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT id FROM public.staff LOOP
        PERFORM public.recalc_weekly_load(r.id);
    END LOOP;
END $$;

-- ============================================================
-- 5. Realtime для фронта
-- ============================================================
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.master_schedule;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.classes;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
