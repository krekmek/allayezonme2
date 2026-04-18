-- 011_substitutions.sql
-- Таблица замен уроков (кто, кого, на каком уроке заменяет)

CREATE TABLE IF NOT EXISTS public.substitutions (
    id                     BIGSERIAL PRIMARY KEY,
    absent_teacher_id      BIGINT NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
    substitute_teacher_id  BIGINT NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
    absence_id             BIGINT REFERENCES public.absences(id) ON DELETE SET NULL,
    date                   DATE NOT NULL DEFAULT CURRENT_DATE,
    day_of_week            INT,
    lesson_number          INT,
    class_name             TEXT,
    subject                TEXT,
    room                   TEXT,
    reason                 TEXT,
    status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'confirmed', 'declined')),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_subs_absent        ON public.substitutions (absent_teacher_id);
CREATE INDEX IF NOT EXISTS idx_subs_substitute    ON public.substitutions (substitute_teacher_id);
CREATE INDEX IF NOT EXISTS idx_subs_status        ON public.substitutions (status);
CREATE INDEX IF NOT EXISTS idx_subs_date_lesson   ON public.substitutions (date DESC, lesson_number);

-- Realtime
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.substitutions;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.substitutions REPLICA IDENTITY FULL;
