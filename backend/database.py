"""Прямое подключение к Postgres Supabase для миграций и сырых SQL-запросов.

Supabase SDK (db.py) работает через REST API с anon-ключом и не умеет выполнять
DDL. Для создания/изменения схемы подключаемся напрямую к Postgres по строке
подключения (DATABASE_URL), которую Supabase выдаёт в Project Settings → Database.
"""
from __future__ import annotations

from pathlib import Path

import psycopg

from config import settings

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def get_connection() -> psycopg.Connection:
    """Открыть подключение к Postgres Supabase."""
    return psycopg.connect(settings.DATABASE_URL, autocommit=True)


def run_migrations() -> None:
    """Применить все .sql файлы из папки migrations по алфавиту."""
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        print("Нет миграций для применения.")
        return

    with get_connection() as conn, conn.cursor() as cur:
        for path in files:
            print(f"→ Применяю {path.name} ...")
            sql = path.read_text(encoding="utf-8")
            cur.execute(sql)
            print(f"  ok")
    print("Все миграции применены.")


if __name__ == "__main__":
    run_migrations()
