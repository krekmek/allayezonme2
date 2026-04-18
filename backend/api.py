"""HTTP API для взаимодействия с дашбордом."""
from __future__ import annotations

import asyncio
import io
import json
from typing import Any

from aiogram import Bot
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI
from pydantic import BaseModel

from audio import transcribe_ogg
from config import settings
from db import (
    create_absence,
    create_substitution,
    create_task_from_dashboard,
    get_staff_by_id,
    list_pending_absences,
    list_staff,
    update_absence_status,
)
from logic import find_substitution
import notifications

# Инициализируем бота для отправки уведомлений
bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)
notifications.set_bot_instance(bot)

app = FastAPI(title="School Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # В проде ограничить доменом
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateTaskRequest(BaseModel):
    description: str
    assignee: str | None = None
    due_date: str | None = None


# LLM клиент для парсинга задач
_llm_client = AsyncOpenAI(
    api_key=settings.GROQ_API_KEY,
    base_url="https://api.groq.com/openai/v1",
)
_LLM_MODEL = "llama-3.3-70b-versatile"


async def parse_tasks_from_text(text: str, staff_list: list[dict]) -> list[dict]:
    """Разделить диктовку на задачи через LLM."""
    # Формируем список имен сотрудников
    staff_names = ", ".join([s["fio"] for s in staff_list])
    
    from datetime import date as _date
    today_str = _date.today().isoformat()
    system_prompt = f"""Ты — ассистент директора школы. Раздели диктовку на отдельные задачи.

Список сотрудников школы (подбирай исполнителя по имени или фамилии, можно частичное совпадение):
{staff_names}

Сегодня: {today_str}. Преобразуй "завтра", "сегодня", "через неделю", "к пятнице" в YYYY-MM-DD.

Правила:
- Любое распоряжение/поручение/задание — это задача, создавай её даже если исполнитель не указан
- Если упомянуто имя (даже частично — "Аскар", "Иван", "Петрова") — ищи ближайшее совпадение в списке
- Если исполнитель не найден — всё равно создай задачу с assignee: null
- Не выдумывай задачи, которых нет в тексте

Верни JSON-объект СТРОГО в формате:
{{
  "tasks": [
    {{
      "description": "суть задачи на русском",
      "assignee": "точное ФИО из списка выше или null",
      "due_date": "YYYY-MM-DD или null"
    }}
  ]
}}

Если задач нет — {{"tasks": []}}. Отвечай только JSON."""

    try:
        response = await _llm_client.chat.completions.create(
            model=_LLM_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        raw = response.choices[0].message.content or "{}"
        print(f"[parse_tasks_from_text] LLM raw: {raw}")
        data = json.loads(raw)
        # LLM может вернуть {"tasks": [...]} или сразу [...]
        if isinstance(data, dict):
            tasks = data.get("tasks") or data.get("задачи") or []
            return tasks if isinstance(tasks, list) else []
        if isinstance(data, list):
            return data
        return []
    except Exception as exc:
        print(f"LLM parsing failed: {exc}")
        return []


class ProcessTextRequest(BaseModel):
    text: str


@app.post("/api/process-text")
async def process_text(request: ProcessTextRequest) -> dict[str, Any]:
    """Принять уже распознанный текст (например, от Web Speech API), извлечь задачи и создать в БД."""
    text = (request.text or "").strip()
    if not text:
        return {"transcript": "", "tasks": [], "count": 0, "error": "Пустой текст"}

    staff_list = await list_staff()
    tasks_data = await parse_tasks_from_text(text, staff_list)

    created_tasks = []
    for task_data in tasks_data:
        try:
            task = await create_task_from_dashboard(
                description=task_data.get("description", ""),
                assignee=task_data.get("assignee"),
                due_date=task_data.get("due_date"),
            )
            created_tasks.append(task)
            if task_data.get("assignee"):
                await notifications.send_task_notification(task)
        except Exception as exc:
            print(f"Failed to create task: {exc}")

    return {
        "transcript": text,
        "tasks": created_tasks,
        "count": len(created_tasks),
    }


@app.post("/api/process-voice")
async def process_voice(audio: UploadFile = File(...)) -> dict[str, Any]:
    """Принять аудиофайл, транскрибировать через Whisper, разделить на задачи и создать в БД."""
    # Читаем аудиофайл
    audio_bytes = await audio.read()
    
    # Транскрибируем через Whisper
    text = await transcribe_ogg(audio_bytes)
    if not text:
        return {"error": "Не удалось транскрибировать аудио", "tasks": []}
    
    # Получаем список сотрудников
    staff_list = await list_staff()
    
    # Парсим задачи через LLM
    tasks_data = await parse_tasks_from_text(text, staff_list)
    
    # Создаем задачи в БД
    created_tasks = []
    for task_data in tasks_data:
        try:
            task = await create_task_from_dashboard(
                description=task_data.get("description", ""),
                assignee=task_data.get("assignee"),
                due_date=task_data.get("due_date"),
            )
            created_tasks.append(task)
            
            # Отправляем уведомление, если указан исполнитель
            if task_data.get("assignee"):
                await notifications.send_task_notification(task)
        except Exception as exc:
            print(f"Failed to create task: {exc}")
    
    return {
        "transcript": text,
        "tasks": created_tasks,
        "count": len(created_tasks),
    }


@app.get("/api/absences")
async def get_absences() -> list[dict[str, Any]]:
    """Получить заявки об отсутствии со статусом pending + информация об учителе."""
    return await list_pending_absences()


@app.get("/api/staff")
async def get_staff_list() -> list[dict[str, Any]]:
    """Список всех сотрудников школы."""
    return await list_staff()


class CreateAbsenceRequest(BaseModel):
    teacher_id: int
    reason_text: str | None = None


@app.post("/api/absences/{absence_id}/cancel")
async def cancel_absence(absence_id: int) -> dict[str, Any]:
    """Отменить заявку об отсутствии (случайно отметили)."""
    updated = await update_absence_status(absence_id, "rejected")
    return {"ok": bool(updated), "absence": updated}


@app.post("/api/absences")
async def create_absence_endpoint(request: CreateAbsenceRequest) -> dict[str, Any]:
    """Создать заявку об отсутствии учителя (с дашборда директора)."""
    teacher = await get_staff_by_id(request.teacher_id)
    if not teacher:
        return {"ok": False, "error": "Учитель не найден"}

    absence = await create_absence(
        teacher_id=request.teacher_id,
        reason_text=request.reason_text,
    )

    return {
        "ok": True,
        "absence": absence,
        "teacher": {"id": teacher["id"], "fio": teacher["fio"]},
    }


class RequestSubstitutionRequest(BaseModel):
    absent_teacher_id: int
    candidate_id: int
    absence_id: int | None = None
    lesson_number: int | None = None
    class_name: str | None = None
    subject: str | None = None
    room: str | None = None
    reason: str | None = None
    day_of_week: int | None = None


@app.post("/api/request-substitution")
async def request_substitution(request: RequestSubstitutionRequest) -> dict[str, Any]:
    """Создать запись о замене со статусом 'pending' и отправить push кандидату.

    - Создаёт запись в `substitutions`.
    - Если передан `absence_id` — помечает заявку об отсутствии как `approved`.
    - Отправляет в Telegram кнопки [✅ Принять] / [❌ Отклонить]."""
    absent = await get_staff_by_id(request.absent_teacher_id)
    candidate = await get_staff_by_id(request.candidate_id)

    if not absent:
        return {"ok": False, "error": "Отсутствующий учитель не найден"}
    if not candidate:
        return {"ok": False, "error": "Кандидат не найден"}
    if not candidate.get("telegram_id"):
        return {
            "ok": False,
            "error": f"У кандидата {candidate.get('fio')} не указан Telegram ID",
        }

    # 1. Создаём запись в substitutions
    substitution = await create_substitution(
        absent_teacher_id=absent["id"],
        substitute_teacher_id=candidate["id"],
        absence_id=request.absence_id,
        lesson_number=request.lesson_number,
        class_name=request.class_name,
        subject=request.subject,
        room=request.room,
        reason=request.reason,
        day_of_week=request.day_of_week,
    )
    sub_id = substitution.get("id") if substitution else None

    # 2. Помечаем absence как approved (если указан)
    if request.absence_id:
        try:
            await update_absence_status(request.absence_id, "approved")
        except Exception:
            pass

    # 3. Push в Telegram
    notified = False
    if sub_id:
        notified = await notifications.send_substitution_notification(
            substitution_id=sub_id,
            candidate=candidate,
            absent_teacher=absent,
            lesson_number=request.lesson_number,
            class_name=request.class_name,
            subject=request.subject,
            room=request.room,
            reason=request.reason,
        )

    return {
        "ok": bool(sub_id),
        "notified": notified,
        "substitution": substitution,
        "message": (
            f"Замена создана, уведомление отправлено {candidate.get('fio')}"
            if notified
            else "Замена создана, но уведомление не отправлено"
        ),
    }


@app.get("/api/substitution/{teacher_id}")
async def get_substitution(
    teacher_id: int,
    lesson_number: int = 1,
    day_of_week: int | None = None,
) -> dict[str, Any]:
    """Найти кандидатов на замену для учителя."""
    candidates = await find_substitution(
        absent_teacher_id=teacher_id,
        lesson_number=lesson_number,
        day_of_week=day_of_week,
    )
    return {"candidates": candidates, "count": len(candidates)}


@app.post("/api/tasks")
async def create_task(request: CreateTaskRequest) -> dict[str, Any]:
    """Создать задачу и отправить уведомление исполнителю."""
    task = await create_task_from_dashboard(
        description=request.description,
        assignee=request.assignee,
        due_date=request.due_date,
    )
    
    # Отправляем уведомление, если указан исполнитель
    if request.assignee:
        await notifications.send_task_notification(task)
    
    return task


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
