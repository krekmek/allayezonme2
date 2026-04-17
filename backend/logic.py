"""Бизнес-логика: подбор замены учителю, статистика и т.п.

Пока содержит `find_substitution` — поиск учителей, которые могут заменить
отсутствующего коллегу на конкретном уроке.
"""
from __future__ import annotations

import asyncio
from typing import Any

from db import supabase


async def find_substitution(
    absent_teacher_id: int,
    lesson_number: int,
    day_of_week: int | None = None,
) -> list[dict[str, Any]]:
    """Подобрать кандидатов на замену отсутствующего учителя.

    Правила:
    1. Кандидат — staff с ролью 'teacher', не сам отсутствующий.
    2. Специализация кандидата совпадает со специализацией отсутствующего.
    3. У кандидата нет своего урока на этом `lesson_number`
       (и, если передан `day_of_week`, именно в этот день).

    Возвращает список записей staff (может быть пустым).
    """
    def _run() -> list[dict[str, Any]]:
        absent_resp = (
            supabase.table("staff")
            .select("id, fio, role, specialization")
            .eq("id", absent_teacher_id)
            .limit(1)
            .execute()
        )
        if not absent_resp.data:
            return []
        absent = absent_resp.data[0]
        specialization = absent.get("specialization")
        if not specialization:
            return []

        candidates_resp = (
            supabase.table("staff")
            .select("id, fio, telegram_id, role, specialization")
            .eq("role", "teacher")
            .eq("specialization", specialization)
            .neq("id", absent_teacher_id)
            .execute()
        )
        candidates: list[dict[str, Any]] = candidates_resp.data or []
        if not candidates:
            return []

        busy_query = (
            supabase.table("schedules")
            .select("teacher_id")
            .eq("lesson_number", lesson_number)
        )
        if day_of_week is not None:
            busy_query = busy_query.eq("day_of_week", day_of_week)
        busy_resp = busy_query.execute()

        busy_ids = {
            row["teacher_id"]
            for row in (busy_resp.data or [])
            if row.get("teacher_id") is not None
        }

        return [c for c in candidates if c["id"] not in busy_ids]

    return await asyncio.to_thread(_run)
