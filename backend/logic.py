"""Бизнес-логика: подбор замены учителю, RAG-ingestion PDF-приказов и пр."""
from __future__ import annotations

import asyncio
import re
from datetime import date, timedelta
from pathlib import Path
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
            .select(
                "id, fio, telegram_id, role, specialization, "
                "weekly_load, max_load"
            )
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

            # Проверка недельной нагрузки по закону (weekly_load / max_load).
            # Жёсткое правило: если уже достигнут максимум — не предлагаем вообще.
            weekly_load = c.get("weekly_load") or 0
            max_load = c.get("max_load") or 0
            if max_load > 0 and weekly_load >= max_load:
                # Перегружен — пропускаем, чтобы не нарушать норму
                continue
            if max_load > 0 and weekly_load >= max_load * 0.9:
                warnings.append(
                    f"Близко к лимиту нагрузки ({weekly_load}ч из {max_load}ч)"
                )

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


# =========================================================================
# RAG: загрузка PDF-приказов в document_chunks с эмбеддингами OpenAI
# =========================================================================

_EMBEDDING_MODEL = "text-embedding-3-small"  # 1536 dim
_CHUNK_SIZE = 800
_CHUNK_OVERLAP = 150
_EMBED_BATCH_SIZE = 64


def _extract_pdf_text(pdf_bytes: bytes) -> str:
    """Извлечь текст из байтов PDF."""
    from io import BytesIO
    from pypdf import PdfReader

    reader = PdfReader(BytesIO(pdf_bytes))
    pages: list[str] = []
    for page in reader.pages:
        try:
            t = page.extract_text() or ""
        except Exception:
            t = ""
        if t.strip():
            pages.append(t)
    full = "\n\n".join(pages)
    full = re.sub(r"[ \t]+", " ", full)
    full = re.sub(r"\n{3,}", "\n\n", full)
    return full.strip()


def _split_chunks(text: str) -> list[str]:
    """Разбить текст на чанки с нахлёстом (RecursiveCharacterTextSplitter)."""
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=_CHUNK_SIZE,
        chunk_overlap=_CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", "! ", "? ", "; ", ", ", " ", ""],
        length_function=len,
    )
    return splitter.split_text(text)


async def ingest_pdf_document(
    pdf_bytes: bytes,
    source_name: str,
    *,
    replace: bool = False,
) -> dict[str, Any]:
    """Загрузить PDF-документ в таблицу document_chunks с эмбеддингами OpenAI.

    Args:
        pdf_bytes: содержимое PDF-файла.
        source_name: имя файла/источника (например, "Приказ_130.pdf").
        replace: если True — сначала удалить существующие чанки с тем же source.

    Returns:
        {"source": ..., "chunks_inserted": N, "total_chars": M, "decree_number": "130"}
    """
    from openai import OpenAI
    from config import settings

    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY не настроен в .env")

    def _run() -> dict[str, Any]:
        # 1. PDF → текст
        text = _extract_pdf_text(pdf_bytes)
        if not text:
            return {
                "source": source_name,
                "chunks_inserted": 0,
                "total_chars": 0,
                "decree_number": None,
                "error": "Пустой текст в PDF",
            }

        # 2. Разбиение на чанки
        chunks = _split_chunks(text)
        if not chunks:
            return {
                "source": source_name,
                "chunks_inserted": 0,
                "total_chars": len(text),
                "decree_number": None,
                "error": "Не удалось разбить текст",
            }

        # 3. Номер приказа из имени
        m = re.search(r"(\d+)", source_name)
        decree_number = m.group(1) if m else None

        # 4. Удаление старых чанков, если replace
        if replace:
            supabase.table("document_chunks").delete().eq(
                "metadata->>source", source_name
            ).execute()

        # 5. Эмбеддинги + вставка батчами
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        total = len(chunks)
        inserted = 0
        for start in range(0, total, _EMBED_BATCH_SIZE):
            batch = chunks[start : start + _EMBED_BATCH_SIZE]
            resp = client.embeddings.create(model=_EMBEDDING_MODEL, input=batch)
            vectors = [item.embedding for item in resp.data]

            rows = []
            for offset, (content, embedding) in enumerate(zip(batch, vectors)):
                idx = start + offset
                rows.append(
                    {
                        "content": content,
                        "metadata": {
                            "source": source_name,
                            "decree_number": decree_number,
                            "chunk_index": idx,
                            "total_chunks": total,
                        },
                        "embedding": embedding,
                    }
                )
            supabase.table("document_chunks").insert(rows).execute()
            inserted += len(rows)

        return {
            "source": source_name,
            "chunks_inserted": inserted,
            "total_chars": len(text),
            "decree_number": decree_number,
        }

    return await asyncio.to_thread(_run)


async def ingest_pdf_from_path(pdf_path: str | Path, *, replace: bool = False) -> dict[str, Any]:
    """Обёртка: прочитать PDF с диска и вызвать ingest_pdf_document."""
    path = Path(pdf_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF не найден: {path}")
    data = path.read_bytes()
    return await ingest_pdf_document(data, path.name, replace=replace)


async def find_free_slot(
    staff_id: int,
    day_of_week: int,
    preferred_lesson: int | None = None,
) -> int | None:
    """Найти ближайший свободный слот в расписании сотрудника на указанный день.

    Если preferred_lesson указан — сначала проверяем его, иначе ищем первый свободный.
    Возвращает lesson_number (1-7) или None, если нет свободных слотов.
    """
    def _run() -> int | None:
        # Получаем все занятые слоты сотрудника на этот день
        resp = (
            supabase.table("schedules")
            .select("lesson_number")
            .eq("teacher_id", staff_id)
            .eq("day_of_week", day_of_week)
            .execute()
        )
        occupied = {row["lesson_number"] for row in resp.data or []}

        # Если preferred_lesson свободен — возвращаем его
        if preferred_lesson and preferred_lesson not in occupied:
            return preferred_lesson

        # Ищем первый свободный слот от 1 до 7
        for lesson in range(1, 8):
            if lesson not in occupied:
                return lesson

        return None

    return await asyncio.to_thread(_run)


async def auto_slot_task(
    task_id: int,
    staff_id: int,
    day_of_week: int,
    preferred_lesson: int | None = None,
) -> dict[str, Any] | None:
    """Автоматически занять свободный слот в расписании для задачи.

    Создаёт запись в schedules с type='task' и связывает с task_id.
    """
    def _run() -> dict[str, Any] | None:
        # Получаем информацию о задаче
        task_resp = (
            supabase.table("tasks")
            .select("*")
            .eq("id", task_id)
            .limit(1)
            .execute()
        )
        if not task_resp.data:
            return None
        task = task_resp.data[0]

        # Находим свободный слот
        lesson = None
        for lesson_num in [preferred_lesson, None]:
            if lesson_num is None:
                continue
            occupied_resp = (
                supabase.table("schedules")
                .select("lesson_number")
                .eq("teacher_id", staff_id)
                .eq("day_of_week", day_of_week)
                .execute()
            )
            occupied = {row["lesson_number"] for row in occupied_resp.data or []}
            if lesson_num not in occupied:
                lesson = lesson_num
                break

        if lesson is None:
            # Ищем любой свободный слот
            for lesson_num in range(1, 8):
                occupied_resp = (
                    supabase.table("schedules")
                    .select("lesson_number")
                    .eq("teacher_id", staff_id)
                    .eq("day_of_week", day_of_week)
                    .execute()
                )
                occupied = {row["lesson_number"] for row in occupied_resp.data or []}
                if lesson_num not in occupied:
                    lesson = lesson_num
                    break

        if lesson is None:
            return None  # Нет свободных слотов

        # Создаём запись в schedules
        schedule_resp = (
            supabase.table("schedules")
            .insert({
                "type": "task",
                "task_id": task_id,
                "teacher_id": staff_id,
                "day_of_week": day_of_week,
                "lesson_number": lesson,
                "class_name": None,  # Задачи не привязаны к классам
                "room": None,  # Задачи могут быть без кабинета
                "subject": task.get("title", "Задача"),
                "title": task.get("title"),
                "description": task.get("description"),
            })
            .execute()
        )

        return (schedule_resp.data or [{}])[0]

    return await asyncio.to_thread(_run)
