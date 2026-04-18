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
    get_substitution_by_id,
    list_pending_absences,
    list_staff,
    update_absence_status,
    update_substitution_status,
)
from logic import find_substitution
import notifications
import rag_service
import whatsapp as wa

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


# Ключевые глаголы действия, которые указывают на валидную задачу
_ACTION_VERBS = [
    "напиши", "напишите", "подготовь", "подготовьте", "проверь", "проверьте",
    "собери", "соберите", "организуй", "организуйте", "отправь", "отправьте",
    "составь", "составьте", "сделай", "сделайте", "купи", "купите",
    "позвони", "позвоните", "назначь", "назначьте", "передай", "передайте",
    "закажи", "закажите", "принеси", "принесите", "создай", "создайте",
    "обнови", "обновите", "исправь", "исправьте", "разработай", "разработайте",
    "представь", "представьте", "распечатай", "распечатайте", "напомни", "напомните",
    "убери", "уберите", "почини", "почините", "проведи", "проведите",
    "разошли", "разошлите", "оформи", "оформите", "внеси", "внесите",
    "найди", "найдите", "замени", "замените", "установи", "установите",
    "запиши", "запишите", "посчитай", "посчитайте", "скажи", "скажите",
    "запусти", "запустите", "удали", "удалите", "добавь", "добавьте",
    "проконтролируй", "сообщи", "сообщите", "уведоми", "уведомите",
    "договорись", "договоритесь", "поручи", "поручите", "нужно", "надо",
    "следует", "должен", "должна", "должны",
]

# Стоп-фразы — явно невалидные
_STOP_PHRASES = [
    "добрый день", "добрый вечер", "доброе утро", "здравствуй", "здравствуйте",
    "привет", "приветствую", "как дела", "как ты", "как вы", "спасибо",
    "пожалуйста", "окей", "ок", "да", "нет", "ага", "угу", "хорошо",
    "понял", "поняла", "поняли", "что делать", "что думаешь", "как тебе",
]


def _heuristic_is_valid(description: str) -> bool | None:
    """Быстрая эвристическая проверка. Возвращает True/False или None (если неясно)."""
    text = description.lower().strip()
    
    # Слишком короткий текст
    if len(text) < 5:
        return False
    
    # Точное совпадение со стоп-фразой
    if text in _STOP_PHRASES:
        return False
    
    # Текст целиком — только стоп-фраза + пунктуация
    clean = text.rstrip(".!?,;: ")
    if clean in _STOP_PHRASES:
        return False
    
    # Есть глагол действия — скорее всего валидно
    words = text.split()
    for word in words:
        word_clean = word.rstrip(".,!?;:")
        if word_clean in _ACTION_VERBS:
            return True
    
    # Неясно — пусть решает LLM
    return None


async def parse_tasks_from_text(text: str, staff_list: list[dict]) -> dict[str, Any]:
    """Intent Guard: классифицирует фразу и возвращает валидные задачи или reason отказа.
    
    Returns:
        {"valid": True, "tasks": [...]}
        {"valid": False, "reason": "not_a_task" | "missing_details", "message": "..."}
    """
    # Быстрая эвристическая проверка
    heuristic = _heuristic_is_valid(text)
    if heuristic is False:
        print(f"[parse_tasks] Heuristic rejected: '{text[:80]}'")
        return {
            "valid": False,
            "reason": "not_a_task",
            "message": "Фраза не содержит поручения",
        }
    
    staff_names = ", ".join([s["fio"] for s in staff_list])
    from datetime import date as _date
    today_str = _date.today().isoformat()
    
    system_prompt = f"""Ты — СТРОГИЙ Intent Guard для системы управления школой. Твоя задача — фильтровать голосовые команды директора.

ДОМЕН: только школьное управление — замены, столовая, хоз. поручения, приказы, отчёты, родительские собрания, проверки, организация мероприятий.

Список сотрудников: {staff_names}
Сегодня: {today_str}

АЛГОРИТМ:
1. Если фраза — случайный разговор, шум, приветствие, междометие или бессмыслица → valid=false, reason="not_a_task"
2. Если фраза похожа на поручение, но БЕЗ конкретики (нет что делать или с чем) → valid=false, reason="missing_details"
3. Только если фраза — ЯВНОЕ школьное поручение с конкретикой → valid=true + список задач

ПРИМЕРЫ ОТКАЗОВ:

Вход: "Привет, как дела"
Выход: {{"valid": false, "reason": "not_a_task", "message": "Это приветствие, не поручение"}}

Вход: "Эй, сделай там что-нибудь"
Выход: {{"valid": false, "reason": "missing_details", "message": "Неясно что именно нужно сделать"}}

Вход: "Надо бы проверить"
Выход: {{"valid": false, "reason": "missing_details", "message": "Непонятно что проверить"}}

Вход: "спасибо, окей, понял"
Выход: {{"valid": false, "reason": "not_a_task", "message": "Подтверждения не являются задачами"}}

Вход: "какая сегодня погода"
Выход: {{"valid": false, "reason": "not_a_task", "message": "Вопрос вне школьной тематики"}}

ПРИМЕРЫ ВАЛИДНЫХ ЗАДАЧ:

Вход: "Напишите отчёт по 5А классу к пятнице"
Выход: {{"valid": true, "tasks": [{{"description": "Написать отчёт по 5А классу", "assignee": null, "due_date": "YYYY-MM-DD (пятница)"}}]}}

Вход: "Иван Петрович подготовьте замену на завтра для Сидоровой"
Выход: {{"valid": true, "tasks": [{{"description": "Подготовить замену для Сидоровой", "assignee": "Иван Петрович...", "due_date": "завтрашняя дата"}}]}}

Вход: "Добрый день, нужно купить мел и проверить столовую"
Выход: {{"valid": true, "tasks": [{{"description": "Купить мел", "assignee": null, "due_date": null}}, {{"description": "Проверить столовую", "assignee": null, "due_date": null}}]}}
(приветствие отброшено, два поручения выделены)

ПРАВИЛА ПАРСИНГА (если valid=true):
- Ищи имена сотрудников по частичному совпадению в списке выше
- Даты: "завтра", "сегодня", "к пятнице" → конкретная YYYY-MM-DD
- Описание — КРАТКОЕ, начинается с глагола действия
- Не включай приветствия и паразитные слова в description

ВАЖНО: При малейших сомнениях — отказывай (valid=false). Лучше попросить уточнить, чем создать мусорную задачу.

Формат ответа — строго JSON:
Для валидных: {{"valid": true, "tasks": [{{"description": "...", "assignee": "ФИО или null", "due_date": "YYYY-MM-DD или null"}}]}}
Для невалидных: {{"valid": false, "reason": "not_a_task" | "missing_details", "message": "короткое объяснение на русском"}}"""

    try:
        response = await _llm_client.chat.completions.create(
            model=_LLM_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text},
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
        )
        raw = response.choices[0].message.content or "{}"
        print(f"[parse_tasks] Intent Guard raw: {raw}")
        data = json.loads(raw)
    except Exception as exc:
        print(f"[parse_tasks] LLM failed: {exc}")
        return {
            "valid": False,
            "reason": "llm_error",
            "message": f"Ошибка AI: {exc}",
        }

    # Если LLM явно отказала
    if isinstance(data, dict) and data.get("valid") is False:
        return {
            "valid": False,
            "reason": data.get("reason", "not_a_task"),
            "message": data.get("message", "ИИ не распознал задачу"),
        }

    # Извлекаем задачи
    if isinstance(data, dict):
        tasks = data.get("tasks") or data.get("задачи") or []
    elif isinstance(data, list):
        tasks = data
    else:
        tasks = []

    if not isinstance(tasks, list):
        tasks = []

    # Фильтруем пустые описания
    valid_tasks = [
        t for t in tasks
        if isinstance(t, dict)
        and t.get("description")
        and len(str(t.get("description", "")).strip()) >= 3
    ]

    if not valid_tasks:
        return {
            "valid": False,
            "reason": "not_a_task",
            "message": "ИИ не нашёл конкретных поручений в фразе",
        }

    print(f"[parse_tasks] Valid: {len(valid_tasks)} tasks")
    return {"valid": True, "tasks": valid_tasks}


class ProcessTextRequest(BaseModel):
    text: str


async def _create_tasks_or_reject(text: str) -> tuple[dict[str, Any], int]:
    """Общая логика: Intent Guard → создание задач или возврат ошибки валидации."""
    from fastapi.responses import JSONResponse  # noqa: F401

    staff_list = await list_staff()
    result = await parse_tasks_from_text(text, staff_list)

    # Intent Guard отклонил — не создаём задачи
    if not result.get("valid"):
        return (
            {
                "valid": False,
                "transcript": text,
                "tasks": [],
                "count": 0,
                "reason": result.get("reason", "not_a_task"),
                "error": result.get("message", "ИИ не распознал задачу. Пожалуйста, уточните распоряжение"),
            },
            400,
        )

    # Валидно — создаём задачи в БД
    created_tasks = []
    for task_data in result.get("tasks", []):
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

    return (
        {
            "valid": True,
            "transcript": text,
            "tasks": created_tasks,
            "count": len(created_tasks),
        },
        200,
    )


@app.post("/api/process-text")
async def process_text(request: ProcessTextRequest):
    """Принять распознанный текст, применить Intent Guard и создать задачи при валидности."""
    from fastapi.responses import JSONResponse

    text = (request.text or "").strip()
    if not text:
        return JSONResponse(
            status_code=400,
            content={
                "valid": False,
                "transcript": "",
                "tasks": [],
                "count": 0,
                "reason": "empty_input",
                "error": "Пустой текст",
            },
        )

    payload, code = await _create_tasks_or_reject(text)
    return JSONResponse(status_code=code, content=payload)


@app.post("/api/process-voice")
async def process_voice(audio: UploadFile = File(...)):
    """Принять аудио, транскрибировать через Whisper, применить Intent Guard и создать задачи."""
    from fastapi.responses import JSONResponse

    audio_bytes = await audio.read()
    text = await transcribe_ogg(audio_bytes)
    if not text:
        return JSONResponse(
            status_code=400,
            content={
                "valid": False,
                "transcript": "",
                "tasks": [],
                "count": 0,
                "reason": "transcription_failed",
                "error": "Не удалось транскрибировать аудио",
            },
        )

    payload, code = await _create_tasks_or_reject(text)
    return JSONResponse(status_code=code, content=payload)


class GenerateDocumentRequest(BaseModel):
    request: str
    director_name: str | None = None
    match_count: int | None = None


@app.post("/api/generate-document")
async def generate_document(payload: GenerateDocumentRequest):
    """Сгенерировать официальное распоряжение директора на основе базы знаний (RAG)."""
    from fastapi.responses import JSONResponse

    text = (payload.request or "").strip()
    if not text:
        return JSONResponse(
            status_code=400,
            content={"error": "Пустой запрос. Опишите суть распоряжения."},
        )

    try:
        result = await rag_service.generate_official_document(
            text,
            match_count=payload.match_count or 6,
            director_name=(payload.director_name or "И.О. Директора"),
        )
        return result
    except Exception as exc:
        print(f"[generate_document] failed: {exc}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Не удалось сгенерировать документ: {exc}"},
        )


@app.get("/api/absences")
async def get_absences() -> list[dict[str, Any]]:
    """Получить заявки об отсутствии со статусом pending + информация об учителе."""
    return await list_pending_absences()


@app.get("/api/staff")
async def get_staff_list() -> list[dict[str, Any]]:
    """Список всех сотрудников школы."""
    return await list_staff()


@app.get("/api/telegram-messages")
async def get_telegram_messages() -> list[dict[str, Any]]:
    """Получить последние Telegram-сообщения с NLP-анализом для витрины."""
    from db import supabase

    def _run():
        resp = (
            supabase.table("telegram_messages")
            .select("*")
            .order("created_at", desc=True)
            .limit(50)
            .execute()
        )
        return resp.data or []

    return await asyncio.to_thread(_run)


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


# ==================== Schedule Generator (CP-SAT) ====================


class BandInput(BaseModel):
    name: str
    classes: list[str]
    subject: str
    hours_per_week: int
    teachers: list[int]
    rooms: list[str]


class GenerateScheduleRequest(BaseModel):
    class_names: list[str] | None = None
    curriculum_overrides: dict[str, dict[str, int]] | None = None
    bands: list[BandInput] | None = None
    days: int = 5
    periods_per_day: int = 7
    time_limit_sec: int = 30
    dry_run: bool = False


@app.post("/api/schedule/generate")
async def generate_schedule_endpoint(request: GenerateScheduleRequest) -> dict[str, Any]:
    """Сгенерировать школьное расписание 'с нуля' CP-SAT солвером.

    Если `dry_run=false` (по умолчанию), текущая таблица `schedules` будет
    очищена и заменена новым расписанием. В `master_schedule` обновятся
    только строки с task_type='lesson'.
    """
    from scheduler_service import regenerate_schedule

    bands_input = None
    if request.bands:
        bands_input = [b.model_dump() for b in request.bands]

    result = await regenerate_schedule(
        class_names=request.class_names,
        curriculum_overrides=request.curriculum_overrides,
        bands_input=bands_input,
        days=request.days,
        periods_per_day=request.periods_per_day,
        time_limit_sec=request.time_limit_sec,
        dry_run=request.dry_run,
    )
    return result


# ==================== Schedule Validation (DnD) ====================


class ValidateScheduleMoveRequest(BaseModel):
    schedule_id: int
    target_day_of_week: int
    target_lesson_number: int
    target_class_name: str | None = None  # по умолчанию — не меняем класс
    target_room: str | None = None         # по умолчанию — не меняем кабинет


@app.post("/api/schedule/validate")
async def validate_schedule_move(req: ValidateScheduleMoveRequest) -> dict[str, Any]:
    """Проверка конфликтов при перетаскивании урока.

    Возвращает:
        {
            "ok": bool,
            "conflicts": [{"type": str, "message": str}, ...],
            "source": {...}   # оригинальный урок
        }

    Проверки:
        * учитель не занят в (target_day, target_lesson) в другой записи;
        * кабинет свободен в (target_day, target_lesson);
        * класс не имеет другого урока в (target_day, target_lesson);
        * нарушение «ленты»: если исходный урок — часть ленты, перемещение
          по-одному ломает параллельность (мягкое предупреждение).
    """
    from db import supabase
    def _run() -> dict[str, Any]:
        # 1. Загружаем исходный урок
        src_resp = (
            supabase.table("schedules")
            .select("*")
            .eq("id", req.schedule_id)
            .limit(1)
            .execute()
        )
        if not src_resp.data:
            return {
                "ok": False,
                "conflicts": [{"type": "not_found", "message": "Урок не найден"}],
            }
        src = src_resp.data[0]

        target_day = req.target_day_of_week
        target_lesson = req.target_lesson_number
        target_class = req.target_class_name or src.get("class_name")
        target_room = req.target_room if req.target_room is not None else src.get("room")

        # Если не меняется — всё ок
        if (
            src.get("day_of_week") == target_day
            and src.get("lesson_number") == target_lesson
            and src.get("class_name") == target_class
        ):
            return {"ok": True, "conflicts": [], "source": src}

        conflicts: list[dict[str, str]] = []

        # 2. Есть ли другой урок в той же (class, day, lesson)
        same_slot = (
            supabase.table("schedules")
            .select("id, class_name, lesson_number, day_of_week, subject, teacher_id, room")
            .eq("class_name", target_class)
            .eq("day_of_week", target_day)
            .eq("lesson_number", target_lesson)
            .execute()
        )
        for row in same_slot.data or []:
            if row["id"] != src["id"]:
                conflicts.append({
                    "type": "class_busy",
                    "message": (
                        f"У класса {target_class} уже есть урок "
                        f"'{row.get('subject')}' в {target_day}-й день, "
                        f"{target_lesson}-й урок"
                    ),
                })

        # 3. Учитель занят в (day, lesson) в другом классе
        if src.get("teacher_id"):
            teacher_busy = (
                supabase.table("schedules")
                .select("id, class_name, subject, day_of_week, lesson_number")
                .eq("teacher_id", src["teacher_id"])
                .eq("day_of_week", target_day)
                .eq("lesson_number", target_lesson)
                .execute()
            )
            for row in teacher_busy.data or []:
                if row["id"] != src["id"]:
                    conflicts.append({
                        "type": "teacher_busy",
                        "message": (
                            f"Учитель уже ведёт '{row.get('subject')}' "
                            f"в классе {row.get('class_name')} в этот слот"
                        ),
                    })

        # 4. Кабинет занят
        if target_room:
            room_busy = (
                supabase.table("schedules")
                .select("id, class_name, subject, teacher_id")
                .eq("room", target_room)
                .eq("day_of_week", target_day)
                .eq("lesson_number", target_lesson)
                .execute()
            )
            for row in room_busy.data or []:
                if row["id"] != src["id"]:
                    conflicts.append({
                        "type": "room_busy",
                        "message": (
                            f"Кабинет {target_room} занят уроком "
                            f"'{row.get('subject')}' в классе {row.get('class_name')}"
                        ),
                    })

        # 5. Проверка «ленты»: если subject содержит маркер '(лента ...)',
        # перемещение одного урока сломает параллельность — это soft-conflict.
        subject = (src.get("subject") or "").lower()
        if "(лента" in subject or "[лента" in subject:
            conflicts.append({
                "type": "band_break",
                "message": (
                    "Этот урок — часть ЛЕНТЫ параллели. "
                    "Перемещение одного урока нарушит синхронность всех групп."
                ),
            })

        return {
            "ok": len(conflicts) == 0,
            "conflicts": conflicts,
            "source": src,
        }

    return await asyncio.to_thread(_run)


# ==================== Twilio WhatsApp Webhook ====================

from fastapi import Request
from fastapi.responses import Response


@app.post("/api/whatsapp/webhook")
async def whatsapp_webhook(request: Request):
    """Twilio WhatsApp входящие сообщения (form-encoded).

    Настройка: в Twilio Console → Messaging → Settings → WhatsApp sandbox settings
    'When a message comes in' → URL этого эндпоинта."""
    form = dict(await request.form())
    parsed = wa.parse_incoming(form)

    from_phone = parsed["from_phone"]         # "whatsapp:+77012345678"
    action = parsed.get("button_action")       # "confirm" | "decline" | None
    sub_id = parsed.get("sub_id")

    # Ответ пользователю — TwiML XML (Twilio его рассылает как reply)
    def twiml(reply_text: str) -> Response:
        xml = f"<?xml version='1.0' encoding='UTF-8'?><Response><Message>{reply_text}</Message></Response>"
        return Response(content=xml, media_type="application/xml")

    if not action or not sub_id:
        return twiml(
            "Привет! Чтобы принять замену, ответьте:\n"
            "ДА <номер>  — принять\n"
            "НЕТ <номер> — отклонить\n\n"
            "Номер замены указан в полученном уведомлении."
        )

    sub = await get_substitution_by_id(sub_id)
    if not sub:
        return twiml(f"❓ Замена №{sub_id} не найдена.")
    if sub.get("status") != "pending":
        return twiml(f"⚠️ Замена №{sub_id} уже обработана: {sub.get('status')}.")

    new_status = "confirmed" if action == "confirm" else "declined"
    await update_substitution_status(sub_id, new_status)

    reply_msg = (
        "✅ Вы приняли замену. Спасибо!"
        if action == "confirm"
        else "❌ Вы отклонили замену. Директор получит уведомление."
    )

    # Уведомление отсутствующему через WhatsApp (если есть)
    absent = sub.get("absent") or {}
    substitute = sub.get("substitute") or {}
    absent_wa = absent.get("whatsapp_phone")
    if absent_wa:
        substitute_name = substitute.get("fio", "Учитель")
        class_name = sub.get("class_name") or "—"
        lesson_number = sub.get("lesson_number") or "—"
        if action == "confirm":
            absent_msg = (
                f"✅ {substitute_name} подтвердил(а) замену\n"
                f"Класс: {class_name}, урок: {lesson_number}"
            )
        else:
            absent_msg = (
                f"❌ {substitute_name} отклонил(а) замену\n"
                f"Класс: {class_name}, урок: {lesson_number}\n"
                f"Нужно выбрать другого учителя."
            )
        await wa.send_text(absent_wa, absent_msg)

    return twiml(reply_msg)


# ==================== Main ====================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
