"""Скрипт для выполнения миграции group_events"""
import sys
from pathlib import Path

# Добавляем backend в путь
sys.path.insert(0, str(Path(__file__).resolve().parent))

from supabase import create_client
from config import settings

client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)

# SQL для создания таблицы
sql = """
CREATE TABLE IF NOT EXISTS public.group_events (
    id              BIGSERIAL PRIMARY KEY,
    raw_text        TEXT        NOT NULL,
    detected_intent TEXT,
    author_telegram_id BIGINT,
    author_name     TEXT,
    author_username TEXT,
    group_chat_id   BIGINT,
    message_id      BIGINT,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_critical     BOOLEAN     DEFAULT FALSE,
    linked_message_id BIGINT,
    processed       BOOLEAN     DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_group_events_timestamp ON public.group_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_group_events_intent ON public.group_events (detected_intent);
CREATE INDEX IF NOT EXISTS idx_group_events_author ON public.group_events (author_telegram_id);
CREATE INDEX IF NOT EXISTS idx_group_events_group ON public.group_events (group_chat_id);

ALTER TABLE public.group_events 
ADD CONSTRAINT IF NOT EXISTS group_events_author_fkey 
FOREIGN KEY (author_telegram_id) REFERENCES public.staff(telegram_id) ON DELETE SET NULL;

ALTER TABLE public.group_events DISABLE ROW LEVEL SECURITY;
"""

print("Создание таблицы group_events...")
try:
    # Используем RPC для выполнения SQL
    result = client.rpc("exec_sql", {"sql": sql})
    print("✅ Таблица group_events создана")
except Exception as e:
    print(f"RPC не сработал: {e}")
    print("\nПожалуйста, выполните этот SQL вручную в Supabase Dashboard:")
    print(sql)
