-- 013_whatsapp.sql
-- Добавляем поле whatsapp_phone в staff для отправки уведомлений в WhatsApp.
-- Формат: международный без плюса, например 77012345678 (KZ), 79161234567 (RU).

ALTER TABLE public.staff
    ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_staff_whatsapp_phone
    ON public.staff (whatsapp_phone);

-- Таблица для входящих WhatsApp-вебхуков (callback от нажатий кнопок)
CREATE TABLE IF NOT EXISTS public.whatsapp_events (
    id          BIGSERIAL PRIMARY KEY,
    wa_id       TEXT,                 -- номер отправителя
    message_id  TEXT,                 -- id сообщения от Meta (для дедупликации)
    type        TEXT,                 -- text / button / interactive / ...
    payload     JSONB,                -- полный payload
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_events_msg
    ON public.whatsapp_events (message_id)
    WHERE message_id IS NOT NULL;
