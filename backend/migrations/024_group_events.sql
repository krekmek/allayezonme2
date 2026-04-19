-- 024_group_events.sql
-- Таблица для хранения событий из группового чата учителей

CREATE TABLE IF NOT EXISTS public.group_events (
    id              BIGSERIAL PRIMARY KEY,
    raw_text        TEXT        NOT NULL,
    detected_intent TEXT,                   -- 'absence', 'substitution', 'incident', 'canteen_report', 'task', 'other'
    author_telegram_id BIGINT,
    author_name     TEXT,                   -- ФИО из таблицы staff
    author_username TEXT,                   -- Telegram username
    group_chat_id   BIGINT,
    message_id      BIGINT,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_critical     BOOLEAN     DEFAULT FALSE,  -- Критический инцидент
    linked_message_id BIGINT,               -- ID связанного сообщения для контекста
    processed       BOOLEAN     DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_group_events_timestamp ON public.group_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_group_events_intent ON public.group_events (detected_intent);
CREATE INDEX IF NOT EXISTS idx_group_events_author ON public.group_events (author_telegram_id);
CREATE INDEX IF NOT EXISTS idx_group_events_group ON public.group_events (group_chat_id);

-- Внешний ключ к staff (без IF NOT EXISTS - PostgreSQL не поддерживает)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'group_events_author_fkey'
    ) THEN
        ALTER TABLE public.group_events 
        ADD CONSTRAINT group_events_author_fkey 
        FOREIGN KEY (author_telegram_id) REFERENCES public.staff(telegram_id) ON DELETE SET NULL;
    END IF;
END $$;

-- Отключаем RLS
ALTER TABLE public.group_events DISABLE ROW LEVEL SECURITY;
