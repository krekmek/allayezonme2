"""Отключение RLS на таблице substitutions."""
import asyncio
from db import supabase

async def main():
    try:
        resp = supabase.rpc("execute_sql", {
            "query": "ALTER TABLE public.substitutions DISABLE ROW LEVEL SECURITY;"
        }).execute()
        print("✅ RLS отключен на таблице substitutions")
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        # Пробуем напрямую через SQL
        try:
            from supabase import create_client
            client = create_client(
                supabase.supabase_url,
                supabase.supabase_key
            )
            # Используем service_role ключ для выполнения SQL
            from config import settings
            admin_client = create_client(
                settings.SUPABASE_URL,
                settings.SUPABASE_SERVICE_ROLE_KEY
            )
            resp = admin_client.rpc("execute_sql", {
                "query": "ALTER TABLE public.substitutions DISABLE ROW LEVEL SECURITY;"
            }).execute()
            print("✅ RLS отключен на таблице substitutions (через service_role)")
        except Exception as e2:
            print(f"❌ Ошибка через service_role: {e2}")
            print("⚠️ Выполните вручную в Supabase SQL Editor:")
            print("ALTER TABLE public.substitutions DISABLE ROW LEVEL SECURITY;")

if __name__ == "__main__":
    asyncio.run(main())
