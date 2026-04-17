"""Клиент Supabase и хелперы для работы с таблицами staff / incidents / schedules.

Supabase-py — синхронный, поэтому в async-коде оборачиваем вызовы через
asyncio.to_thread, чтобы не блокировать event loop aiogram.
"""
from __future__ import annotations

import asyncio
from typing import Any

from supabase import Client, create_client

from config import settings

supabase: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)


# ========== staff ==========

async def get_staff_by_tg_id(telegram_id: int) -> dict[str, Any] | None:
    """Вернуть запись сотрудника по telegram_id или None, если не найден."""
    def _run() -> dict[str, Any] | None:
        resp = (
            supabase.table("staff")
            .select("*")
            .eq("telegram_id", telegram_id)
            .limit(1)
            .execute()
        )
        return resp.data[0] if resp.data else None

    return await asyncio.to_thread(_run)


async def get_staff_by_id(staff_id: int) -> dict[str, Any] | None:
    """Вернуть запись сотрудника по первичному ключу id."""
    def _run() -> dict[str, Any] | None:
        resp = (
            supabase.table("staff")
            .select("*")
            .eq("id", staff_id)
            .limit(1)
            .execute()
        )
        return resp.data[0] if resp.data else None

    return await asyncio.to_thread(_run)


async def list_staff() -> list[dict[str, Any]]:
    """Вернуть всех сотрудников (для выбора в /login_as)."""
    def _run() -> list[dict[str, Any]]:
        resp = supabase.table("staff").select("*").order("id").execute()
        return resp.data or []

    return await asyncio.to_thread(_run)


async def find_staff_by_fio(fio_substring: str) -> list[dict[str, Any]]:
    """Найти сотрудников, у которых ФИО содержит подстроку (регистронезависимо)."""
    def _run() -> list[dict[str, Any]]:
        resp = (
            supabase.table("staff")
            .select("*")
            .ilike("fio", f"%{fio_substring}%")
            .execute()
        )
        return resp.data or []

    return await asyncio.to_thread(_run)


async def create_staff(
    *,
    fio: str,
    role: str,
    telegram_id: int | None = None,
    specialization: str | None = None,
) -> dict[str, Any]:
    """Создать сотрудника и вернуть вставленную запись."""
    def _run() -> dict[str, Any]:
        resp = (
            supabase.table("staff")
            .insert(
                {
                    "fio": fio,
                    "role": role,
                    "telegram_id": telegram_id,
                    "specialization": specialization,
                }
            )
            .execute()
        )
        return resp.data[0]

    return await asyncio.to_thread(_run)


# ========== tasks ==========

async def create_task(
    *,
    description: str,
    created_by_tg_id: int,
    assignee: str | None = None,
    due_date: str | None = None,  # ISO-формат YYYY-MM-DD
    source: str = "text",
) -> dict[str, Any]:
    """Создать задачу (например, надиктованную директором)."""
    def _run() -> dict[str, Any]:
        resp = (
            supabase.table("tasks")
            .insert(
                {
                    "description": description,
                    "created_by_tg_id": created_by_tg_id,
                    "assignee": assignee,
                    "due_date": due_date,
                    "source": source,
                }
            )
            .execute()
        )
        return resp.data[0]

    return await asyncio.to_thread(_run)


# ========== incidents ==========

async def create_incident(
    *,
    description: str,
    created_by_tg_id: int,
    location: str | None = None,
    status: str = "new",
) -> dict[str, Any]:
    """Создать инцидент / заявку."""
    def _run() -> dict[str, Any]:
        resp = (
            supabase.table("incidents")
            .insert(
                {
                    "description": description,
                    "status": status,
                    "created_by_tg_id": created_by_tg_id,
                    "location": location,
                }
            )
            .execute()
        )
        return resp.data[0]

    return await asyncio.to_thread(_run)
