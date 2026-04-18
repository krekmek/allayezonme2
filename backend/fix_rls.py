"""Скрипт для отключения RLS на таблице staff"""
import sys
from pathlib import Path

# Добавляем backend в путь
sys.path.insert(0, str(Path(__file__).resolve().parent))

from supabase import create_client
from config import settings

# Используем service role key для административных операций
# Если SERVICE_ROLE_KEY не задан, используем ANON_KEY
SERVICE_ROLE_KEY = getattr(settings, "SUPABASE_SERVICE_ROLE_KEY", None) or settings.SUPABASE_ANON_KEY

client = create_client(settings.SUPABASE_URL, SERVICE_ROLE_KEY)

# Выполняем SQL для отключения RLS
try:
    result = client.rpc("exec_sql", {
        "sql": "ALTER TABLE public.staff DISABLE ROW LEVEL SECURITY;"
    })
    print("RLS отключен через RPC")
except Exception as e:
    print(f"RPC не сработал: {e}")
    print("\nПожалуйста, выполните этот SQL вручную в Supabase Dashboard:")
    print("ALTER TABLE public.staff DISABLE ROW LEVEL SECURITY;")
