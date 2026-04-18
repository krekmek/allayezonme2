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


# ========== attendance_reports ==========

async def create_attendance_report(
    *,
    class_name: str | None,
    present_count: int,
    absent_count: int,
    absent_list: list[str],
    portions: int,
    raw_text: str,
    created_by_tg_id: int,
) -> dict[str, Any]:
    """Создать структурированный отчёт по посещаемости (для столовой)."""
    def _run() -> dict[str, Any]:
        resp = (
            supabase.table("attendance_reports")
            .insert(
                {
                    "class_name": class_name,
                    "present_count": present_count,
                    "absent_count": absent_count,
                    "absent_list": absent_list,
                    "portions": portions,
                    "raw_text": raw_text,
                    "created_by_tg_id": created_by_tg_id,
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


async def search_tasks_by_date(
    *,
    date_str: str | None = None,
    description_keyword: str | None = None,
    created_by_tg_id: int | None = None,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Поиск задач по дате и/или ключевому слову в описании."""
    def _run() -> list[dict[str, Any]]:
        query = supabase.table("tasks").select("*").order("created_at", desc=True).limit(limit)
        
        if date_str:
            query = query.eq("due_date", date_str)
        
        if description_keyword:
            query = query.ilike("description", f"%{description_keyword}%")
        
        if created_by_tg_id:
            query = query.eq("created_by_tg_id", created_by_tg_id)
        
        resp = query.execute()
        return resp.data or []

    return await asyncio.to_thread(_run)


async def update_task_status(
    task_id: int,
    status: str,
) -> dict[str, Any] | None:
    """Обновить статус задачи."""
    def _run() -> dict[str, Any] | None:
        resp = (
            supabase.table("tasks")
            .update({"status": status})
            .eq("id", task_id)
            .execute()
        )
        return resp.data[0] if resp.data else None

    return await asyncio.to_thread(_run)


async def get_staff_by_name(assignee_name: str) -> dict[str, Any] | None:
    """Найти сотрудника по ФИО для получения telegram_id."""
    def _run() -> dict[str, Any] | None:
        resp = (
            supabase.table("staff")
            .select("*")
            .ilike("fio", f"%{assignee_name}%")
            .limit(1)
            .execute()
        )
        return resp.data[0] if resp.data else None

    return await asyncio.to_thread(_run)


async def create_task_from_dashboard(
    description: str,
    assignee: str | None,
    due_date: str | None,
) -> dict[str, Any]:
    """Создать задачу с дашборда (для отправки уведомления через бот)."""
    def _run() -> dict[str, Any]:
        resp = (
            supabase.table("tasks")
            .insert({
                "description": description,
                "assignee": assignee,
                "due_date": due_date,
                "status": "new",
                "source": "text",
                "created_by_tg_id": 0,  # 0 означает "создано с дашборда"
            })
            .execute()
        )
        return resp.data[0] if resp.data else {}

    return await asyncio.to_thread(_run)


async def add_teacher_points(staff_id: int, points: int = 1) -> dict[str, Any] | None:
    """Добавить очки учителю за оперативность."""
    def _run() -> dict[str, Any] | None:
        # Проверяем, есть ли запись для учителя
        existing_resp = (
            supabase.table("teacher_points")
            .select("*")
            .eq("staff_id", staff_id)
            .limit(1)
            .execute()
        )
        
        if existing_resp.data:
            # Обновляем существующую запись
            existing = existing_resp.data[0]
            new_points = existing.get("points", 0) + points
            new_count = existing.get("reports_before_09_count", 0) + 1
            resp = (
                supabase.table("teacher_points")
                .update({
                    "points": new_points,
                    "reports_before_09_count": new_count,
                    "last_report_at": "NOW()",
                    "updated_at": "NOW()",
                })
                .eq("staff_id", staff_id)
                .select()
                .single()
                .execute()
            )
            return resp.data
        else:
            # Создаём новую запись
            resp = (
                supabase.table("teacher_points")
                .insert({
                    "staff_id": staff_id,
                    "points": points,
                    "reports_before_09_count": 1,
                    "last_report_at": "NOW()",
                })
                .select()
                .single()
                .execute()
            )
            return resp.data

    return await asyncio.to_thread(_run)


async def get_top_teachers_by_points(limit: int = 3) -> list[dict[str, Any]]:
    """Получить топ учителей по очкам."""
    def _run() -> list[dict[str, Any]]:
        resp = (
            supabase.table("teacher_points")
            .select("*, staff(fio, specialization)")
            .order("points", desc=True)
            .limit(limit)
            .execute()
        )
        return resp.data or []

    return await asyncio.to_thread(_run)


async def get_teacher_points(staff_id: int) -> dict[str, Any] | None:
    """Получить очки учителя."""
    def _run() -> dict[str, Any] | None:
        resp = (
            supabase.table("teacher_points")
            .select("*")
            .eq("staff_id", staff_id)
            .limit(1)
            .execute()
        )
        return resp.data[0] if resp.data else None

    return await asyncio.to_thread(_run)


# ========== absences / voice-notes ==========

VOICE_BUCKET = "voice-notes"


async def upload_voice_note(audio_bytes: bytes, filename: str, content_type: str = "audio/ogg") -> str | None:
    """Загрузить аудио в Supabase Storage bucket voice-notes. Возвращает public URL."""
    def _run() -> str | None:
        try:
            supabase.storage.from_(VOICE_BUCKET).upload(
                path=filename,
                file=audio_bytes,
                file_options={"content-type": content_type, "upsert": "true"},
            )
            public_url = supabase.storage.from_(VOICE_BUCKET).get_public_url(filename)
            return public_url
        except Exception as exc:
            import logging
            logging.exception("Failed to upload voice note: %s", exc)
            return None

    return await asyncio.to_thread(_run)


async def create_absence(
    teacher_id: int,
    reason_text: str | None = None,
    voice_url: str | None = None,
    absence_date: str | None = None,
) -> dict[str, Any] | None:
    """Создать заявку об отсутствии."""
    def _run() -> dict[str, Any] | None:
        payload: dict[str, Any] = {
            "teacher_id": teacher_id,
            "reason_text": reason_text,
            "voice_url": voice_url,
            "status": "pending",
        }
        if absence_date:
            payload["date"] = absence_date
        resp = supabase.table("absences").insert(payload).execute()
        return resp.data[0] if resp.data else None

    return await asyncio.to_thread(_run)


async def list_pending_absences() -> list[dict[str, Any]]:
    """Получить все заявки со статусом pending + инфо об учителе (JOIN staff)."""
    def _run() -> list[dict[str, Any]]:
        resp = (
            supabase.table("absences")
            .select("*, staff:teacher_id(id, fio, role, specialization, telegram_id)")
            .eq("status", "pending")
            .order("created_at", desc=True)
            .execute()
        )
        return resp.data or []

    return await asyncio.to_thread(_run)
