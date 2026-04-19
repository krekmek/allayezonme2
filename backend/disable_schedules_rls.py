"""Скрипт для отключения RLS на таблице schedules"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from supabase import create_client
from config import settings

client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)

sql = "ALTER TABLE public.schedules DISABLE ROW LEVEL SECURITY;"

print("Отключение RLS на таблице schedules...")
try:
    result = client.rpc("exec_sql", {"sql": sql})
    print("✅ RLS на schedules отключен")
except Exception as e:
    print(f"RPC не сработал: {e}")
    print("\nПожалуйста, выполните этот SQL вручную в Supabase Dashboard:")
    print(sql)
