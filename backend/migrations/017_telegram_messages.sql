-- ============================================================
-- Таблица для хранения входящих Telegram-сообщений с NLP-анализом
-- Для витрины "Центр обработки данных" на дашборде
-- ============================================================

CREATE TABLE IF NOT EXISTS public.telegram_messages (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL,                    -- Telegram message_id
    chat_id BIGINT NOT NULL,                       -- Telegram chat_id
    user_id BIGINT,                                -- Telegram user_id (если есть)
    username TEXT,                                 -- Telegram username
    first_name TEXT,
    last_name TEXT,
    raw_text TEXT NOT NULL,                        -- Исходный текст сообщения
    parsed_entities JSONB,                         -- Распознанные сущности: {name, type, class, teacher, etc.}
    intent TEXT,                                   -- Интент: substitution, task, sick_day, etc.
    confidence FLOAT,                              -- Уверенность NLP-модели (0-1)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,                      -- Когда обработано
    staff_id INTEGER REFERENCES public.staff(id), -- Связь с сотрудником (если распознан)
    metadata JSONB                                 -- Доп. данные: lesson_number, class_name, etc.
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_telegram_messages_chat_id ON public.telegram_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_created_at ON public.telegram_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_staff_id ON public.telegram_messages(staff_id);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_intent ON public.telegram_messages(intent);

-- RLS (если нужно включить позже)
-- ALTER TABLE public.telegram_messages ENABLE ROW LEVEL SECURITY;
