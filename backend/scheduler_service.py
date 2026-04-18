"""Мост между Supabase и scheduler_engine.

Собирает матрицы входных данных (классы, учителя, кабинеты, ленты),
вызывает CP-SAT solver и записывает результат в таблицу `schedules`
(и, если таблица существует, — в master_schedule).
"""
from __future__ import annotations

import asyncio
from typing import Any

from db import supabase
from scheduler_engine import (
    BandSpec,
    ClassPlan,
    RoomSpec,
    SchedulerResult,
    TeacherSpec,
    generate_schedule,
)


# ============================================================
# Дефолты (если не передано с фронта)
# ============================================================

# Стандартный базовый учебный план среднего класса, часов в неделю
DEFAULT_CURRICULUM: dict[str, int] = {
    "математика": 5,
    "русский язык": 4,
    "английский язык": 3,
    "история": 2,
    "биология": 2,
    "физика": 2,
    "информатика": 1,
    "физкультура": 2,
}

# Маппинг supabase staff.specialization → предмет в учебном плане
SPEC_TO_SUBJECT = {
    "математика": "математика",
    "русский язык": "русский язык",
    "английский язык": "английский язык",
    "история": "история",
    "биология": "биология",
    "физика": "физика",
    "информатика": "информатика",
    "физкультура": "физкультура",
}

# Дефолтные кабинеты, если в БД нет rooms (привязки по specialization)
DEFAULT_ROOMS: list[tuple[str, list[str] | None]] = [
    ("201", ["математика"]),
    ("202", ["математика"]),
    ("105", ["русский язык"]),
    ("106", ["русский язык"]),
    ("215", ["физика"]),
    ("212", ["биология"]),
    ("308", ["история"]),
    ("310", ["английский язык"]),
    ("311", ["английский язык"]),
    ("312", ["английский язык"]),
    ("313", ["английский язык"]),
    ("401", ["информатика"]),
    ("зал", ["физкультура"]),
]


# ============================================================
# Сбор входных данных из БД
# ============================================================

async def build_input_from_db(
    class_names: list[str] | None = None,
    curriculum_overrides: dict[str, dict[str, int]] | None = None,
    bands_input: list[dict[str, Any]] | None = None,
    days: int = 5,
    periods_per_day: int = 7,
) -> dict[str, Any]:
    """Подготовить матрицы для solver.

    Args:
        class_names: какие классы генерировать (по умолчанию все из `classes`).
        curriculum_overrides: {class_name: {subject: hours}} — переопределения.
        bands_input: список band dict: {name, classes, subject, hours_per_week,
                     teachers (ids), rooms (names)}.
    """
    def _run() -> dict[str, Any]:
        # Классы
        cls_resp = supabase.table("classes").select("*").execute()
        db_classes = cls_resp.data or []

        # Если в БД нет classes — fallback на дефолтный список
        if not db_classes:
            db_classes = [
                {"name": "5А"}, {"name": "6Б"}, {"name": "7В"},
                {"name": "8А"}, {"name": "9Б"},
            ]

        if class_names:
            db_classes = [c for c in db_classes if c["name"] in class_names]

        # Учителя
        teachers_resp = (
            supabase.table("staff")
            .select("id, fio, role, specialization, max_load")
            .eq("role", "teacher")
            .execute()
        )
        db_teachers = teachers_resp.data or []

        return {"db_classes": db_classes, "db_teachers": db_teachers}

    data = await asyncio.to_thread(_run)
    db_classes = data["db_classes"]
    db_teachers = data["db_teachers"]

    # --- Учебные планы ---
    classes: list[ClassPlan] = []
    for c in db_classes:
        name = c["name"]
        plan = dict(DEFAULT_CURRICULUM)
        if curriculum_overrides and name in curriculum_overrides:
            plan = dict(curriculum_overrides[name])
        # если класс участвует в ленте — вычитаем часы из обычного плана
        if bands_input:
            for b in bands_input:
                if name in b.get("classes", []):
                    subj = b["subject"]
                    hrs = int(b.get("hours_per_week", 0))
                    if subj in plan:
                        plan[subj] = max(0, plan[subj] - hrs)
                    if plan.get(subj, 0) == 0:
                        plan.pop(subj, None)
        classes.append(ClassPlan(name=name, subjects=plan))

    # --- Учителя ---
    teachers: list[TeacherSpec] = []
    for t in db_teachers:
        spec = (t.get("specialization") or "").strip().lower()
        subject = SPEC_TO_SUBJECT.get(spec)
        subjects = [subject] if subject else []
        # Если специализация не распознана, считаем что учитель универсал-начальник:
        # лучше пропустить, чтобы не ломать constraint.
        if not subjects:
            continue
        max_hours = int(t.get("max_load") or 24)
        teachers.append(TeacherSpec(
            id=int(t["id"]),
            name=t["fio"],
            subjects=subjects,
            max_hours=max_hours,
        ))

    # --- Кабинеты (пока из DEFAULT_ROOMS — в БД пока нет такой таблицы) ---
    rooms: list[RoomSpec] = [
        RoomSpec(name=name, suitable_for=suitable)
        for name, suitable in DEFAULT_ROOMS
    ]

    # --- Ленты ---
    bands: list[BandSpec] = []
    if bands_input:
        for b in bands_input:
            bands.append(BandSpec(
                name=b["name"],
                classes=list(b["classes"]),
                subject=b["subject"],
                hours_per_week=int(b["hours_per_week"]),
                teachers=[int(x) for x in b["teachers"]],
                rooms=list(b["rooms"]),
            ))

    return {
        "classes": classes,
        "teachers": teachers,
        "rooms": rooms,
        "bands": bands,
        "days": days,
        "periods_per_day": periods_per_day,
    }


# ============================================================
# Запись результата в Supabase
# ============================================================

async def persist_schedule(result: SchedulerResult) -> dict[str, Any]:
    """Очистить таблицу schedules и master_schedule (lessons)
    и записать новое расписание, сгенерированное solver.
    """
    def _run() -> dict[str, Any]:
        # Очистка
        # Supabase-py требует фильтр для delete — используем neq('id', 0)
        supabase.table("schedules").delete().neq("id", 0).execute()
        try:
            supabase.table("master_schedule").delete().eq("task_type", "lesson").execute()
        except Exception:
            pass  # если таблицы нет

        # Подготовка batch
        rows_schedules = []
        rows_master = []
        for l in result.lessons:
            rows_schedules.append({
                "class_name": l.class_name,
                "lesson_number": l.lesson_number,
                "teacher_id": l.teacher_id,
                "room": l.room,
                "subject": l.subject + (f" (лента {l.band_name})" if l.band_name else ""),
                "day_of_week": l.day_of_week,
            })
            rows_master.append({
                "staff_id": l.teacher_id,
                "day_of_week": l.day_of_week,
                "time_slot": l.lesson_number,
                "location": l.room,
                "task_description": f"{l.subject} · {l.class_name}"
                                    + (f" [лента {l.band_name}]" if l.band_name else ""),
                "task_type": "lesson",
                "class_name": l.class_name,
            })

        inserted_sch = 0
        if rows_schedules:
            # батчами по 500
            for i in range(0, len(rows_schedules), 500):
                batch = rows_schedules[i:i + 500]
                supabase.table("schedules").insert(batch).execute()
                inserted_sch += len(batch)

        inserted_ms = 0
        if rows_master:
            try:
                for i in range(0, len(rows_master), 500):
                    batch = rows_master[i:i + 500]
                    # upsert чтобы не падать на уникальном ключе (staff_id, day, slot)
                    supabase.table("master_schedule").upsert(
                        batch, on_conflict="staff_id,day_of_week,time_slot"
                    ).execute()
                    inserted_ms += len(batch)
            except Exception as e:
                # master_schedule опционально
                return {
                    "inserted_schedules": inserted_sch,
                    "inserted_master_schedule": 0,
                    "master_schedule_error": str(e),
                }

        return {
            "inserted_schedules": inserted_sch,
            "inserted_master_schedule": inserted_ms,
        }

    return await asyncio.to_thread(_run)


# ============================================================
# Высокоуровневая функция для API
# ============================================================

async def regenerate_schedule(
    *,
    class_names: list[str] | None = None,
    curriculum_overrides: dict[str, dict[str, int]] | None = None,
    bands_input: list[dict[str, Any]] | None = None,
    days: int = 5,
    periods_per_day: int = 7,
    time_limit_sec: int = 30,
    dry_run: bool = False,
) -> dict[str, Any]:
    inp = await build_input_from_db(
        class_names=class_names,
        curriculum_overrides=curriculum_overrides,
        bands_input=bands_input,
        days=days,
        periods_per_day=periods_per_day,
    )

    result = await asyncio.to_thread(
        generate_schedule,
        inp["classes"],
        inp["teachers"],
        inp["rooms"],
        inp["bands"],
        days,
        periods_per_day,
        time_limit_sec,
    )

    payload: dict[str, Any] = {
        "status": result.status,
        "message": result.message,
        "solver_wall_time": round(result.solver_wall_time, 3),
        "objective_gaps": result.objective,
        "lessons_count": len(result.lessons),
        "teacher_stats": result.teacher_stats,
        "lessons": [
            {
                "class_name": l.class_name,
                "subject": l.subject,
                "teacher_id": l.teacher_id,
                "teacher_name": l.teacher_name,
                "room": l.room,
                "day_of_week": l.day_of_week,
                "lesson_number": l.lesson_number,
                "band": l.band_name,
            }
            for l in result.lessons
        ],
    }

    if result.status in ("OPTIMAL", "FEASIBLE") and not dry_run:
        persist = await persist_schedule(result)
        payload.update(persist)

    return payload
