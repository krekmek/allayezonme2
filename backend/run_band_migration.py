"""Скрипт для выполнения миграции band_name"""
import sys
from pathlib import Path

# Добавляем backend в путь
sys.path.insert(0, str(Path(__file__).resolve().parent))

from supabase import create_client
from config import settings

client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)

# SQL для добавления band_name
sql = """
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS band_name TEXT;

CREATE INDEX IF NOT EXISTS idx_schedules_band_name ON public.schedules(band_name);
"""

print("Добавление поля band_name в таблицу schedules...")
try:
    # Используем RPC для выполнения SQL
    result = client.rpc("exec_sql", {"sql": sql})
    print("✅ Поле band_name добавлено")
except Exception as e:
    print(f"RPC не сработал: {e}")
    print("\nПожалуйста, выполните этот SQL вручную в Supabase Dashboard:")
    print(sql)
