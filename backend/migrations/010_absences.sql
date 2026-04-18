-- 010_absences.sql
-- Таблица заявок об отсутствии учителей (болезнь, отгул и т.д.)

CREATE TABLE IF NOT EXISTS public.absences (
    id          BIGSERIAL PRIMARY KEY,
    teacher_id  BIGINT NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
    date        DATE NOT NULL DEFAULT CURRENT_DATE,
    reason_text TEXT,
    voice_url   TEXT,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'resolved')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_absences_teacher_id ON public.absences (teacher_id);
CREATE INDEX IF NOT EXISTS idx_absences_status     ON public.absences (status);
CREATE INDEX IF NOT EXISTS idx_absences_date       ON public.absences (date DESC);

-- Включаем Realtime (идемпотентно)
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.absences;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Для корректных UPDATE/DELETE payload
ALTER TABLE public.absences REPLICA IDENTITY FULL;

-- Storage-бакет voice-notes нужно создать вручную в Supabase Dashboard
-- или через SQL ниже (требует service_role):
-- INSERT INTO storage.buckets (id, name, public) VALUES ('voice-notes', 'voice-notes', true)
-- ON CONFLICT DO NOTHING;
