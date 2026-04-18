"""Бизнес-логика: подбор замены учителю, статистика и т.п.

Пока содержит `find_substitution` — поиск учителей, которые могут заменить
отсутствующего коллегу на конкретном уроке.
"""
from __future__ import annotations

import asyncio
from datetime import date, timedelta
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
    4. Проверка кабинета: если у кандидата есть урок на это время в другом кабинете -
       добавляется предупреждение о нарушении СанПиН.
    5. Проверка нагрузки: если у кандидата больше 6 уроков в день -
       добавляется предупреждение о нарушении СанПиН.

    Возвращает список записей staff с полем warnings (список строк) (может быть пустым).
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

        # Получаем кабинет отсутствующего учителя на этот урок
        absent_room = None
        if day_of_week is not None:
            absent_lesson_resp = (
                supabase.table("schedules")
                .select("room")
                .eq("teacher_id", absent_teacher_id)
                .eq("lesson_number", lesson_number)
                .eq("day_of_week", day_of_week)
                .limit(1)
                .execute()
            )
            if absent_lesson_resp.data:
                absent_room = absent_lesson_resp.data[0].get("room")

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

        result = []
        for c in candidates:
            if c["id"] in busy_ids:
                # Учитель занят на этом уроке - не подходит
                continue
            
            warnings = []
            
            # Проверка кабинета на соседних уроках (предыдущий и следующий)
            if day_of_week is not None and absent_room:
                for adjacent_lesson in [lesson_number - 1, lesson_number + 1]:
                    if 1 <= adjacent_lesson <= 12:
                        adjacent_resp = (
                            supabase.table("schedules")
                            .select("room")
                            .eq("teacher_id", c["id"])
                            .eq("lesson_number", adjacent_lesson)
                            .eq("day_of_week", day_of_week)
                            .limit(1)
                            .execute()
                        )
                        if adjacent_resp.data:
                            adjacent_room = adjacent_resp.data[0].get("room")
                            if adjacent_room and adjacent_room != absent_room:
                                warnings.append("Нарушение санпина: разные кабинеты")
                                break
            
            # Проверка нагрузки в день
            if day_of_week is not None:
                daily_lessons_resp = (
                    supabase.table("schedules")
                    .select("id")
                    .eq("teacher_id", c["id"])
                    .eq("day_of_week", day_of_week)
                    .execute()
                )
                lesson_count = len(daily_lessons_resp.data or [])
                if lesson_count >= 6:
                    warnings.append("Нарушение санпина: более 6 уроков в день")
            
            c["warnings"] = warnings
            result.append(c)

        return result

    return await asyncio.to_thread(_run)


async def generate_tomorrow_substitution_draft(
    teacher_id: int,
) -> dict[str, Any]:
    """Сгенерировать черновик замен на завтра для учителя.

    Возвращает информацию об уроках учителя на завтра и потенциальных заменах.
    """
    def _run() -> dict[str, Any]:
        # Определяем завтрашний день недели
        tomorrow = date.today() + timedelta(days=1)
        tomorrow_dow = tomorrow.weekday() + 1  # 1=Пн, ..., 7=Вс

        # Получаем уроки учителя на завтра
        lessons_resp = (
            supabase.table("schedules")
            .select("*")
            .eq("teacher_id", teacher_id)
            .eq("day_of_week", tomorrow_dow)
            .order("lesson_number")
            .execute()
        )
        lessons = lessons_resp.data or []

        if not lessons:
            return {"lessons": [], "substitutions": []}

        # Получаем информацию об учителе
        teacher_resp = (
            supabase.table("staff")
            .select("*")
            .eq("id", teacher_id)
            .limit(1)
            .execute()
        )
        teacher = teacher_resp.data[0] if teacher_resp.data else None

        substitutions = []
        for lesson in lessons:
            # Ищем кандидатов на замену для каждого урока
            candidates = asyncio.run(find_substitution(
                absent_teacher_id=teacher_id,
                lesson_number=lesson["lesson_number"],
                day_of_week=tomorrow_dow,
            ))
            
            substitutions.append({
                "lesson_number": lesson["lesson_number"],
                "class_name": lesson["class_name"],
                "room": lesson["room"],
                "subject": lesson["subject"],
                "candidates": candidates,
            })

        return {
            "teacher": teacher,
            "date": tomorrow.isoformat(),
            "day_of_week": tomorrow_dow,
            "lessons": lessons,
            "substitutions": substitutions,
        }

    return await asyncio.to_thread(_run)
