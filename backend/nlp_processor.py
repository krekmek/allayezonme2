"""NLP-классификатор входящих сообщений на GPT-4o-mini.

Возвращает тип сообщения и извлечённые детали, чтобы бот мог маршрутизировать
ввод пользователя без явных команд.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Literal, TypedDict

from openai import AsyncOpenAI

from config import settings

logger = logging.getLogger(__name__)

MessageType = Literal["attendance", "incident", "question", "task", "unknown"]


class Classification(TypedDict):
    type: MessageType
    summary: str
    details: dict[str, Any]


# Groq предоставляет OpenAI-совместимый API — бесплатный тир, быстрый инференс Llama.
# https://console.groq.com/docs/openai
_client = AsyncOpenAI(
    api_key=settings.GROQ_API_KEY,
    base_url="https://api.groq.com/openai/v1",
)

_MODEL = "llama-3.3-70b-versatile"

_SYSTEM_PROMPT = """Ты — NLP-классификатор сообщений школьного Telegram-бота.
Твоя задача — определить тип сообщения и извлечь ключевые детали.

Верни СТРОГО JSON-объект со следующими полями:
{
  "type": "attendance" | "incident" | "question" | "task" | "unknown",
  "summary": "короткое резюме сообщения на русском (1 предложение)",
  "details": { ... произвольные извлечённые поля ... }
}

Правила классификации:
- "attendance" — отчёт по посещаемости детей/класса
  (например: "В 5А отсутствуют Иванов и Петров", "все на месте", "болеет 3 человека").
  В details извлекай: class_name (если есть), absent (список ФИО), present_count (число).
- "incident" — жалоба на поломку, проблему с инфраструктурой, ЧП
  (например: "в 203 кабинете течёт кран", "не работает проектор", "разбито окно").
  В details извлекай: location (место), issue (суть проблемы).
- "task" — поручение, задача, распоряжение (часто от директора)
  (например: "завтра провести педсовет в 15:00", "Иванову подготовить отчёт к пятнице",
  "напомнить всем про субботник 20 числа").
  В details извлекай: assignee (кому поручено, если указано), due_date (срок в формате YYYY-MM-DD, если можно вычислить), title (краткая формулировка).
- "question" — вопрос к школе/администрации/учителям
  (например: "когда родительское собрание?", "где расписание?", "как записать ребёнка?").
  В details извлекай: topic (тема вопроса).
- "unknown" — если не подходит ни под одну категорию.

Отвечай только JSON, без пояснений и markdown-оборачивания."""


async def classify_message(text: str) -> Classification:
    """Классифицировать текст пользователя через GPT-4o-mini."""
    try:
        response = await _client.chat.completions.create(
            model=_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        logger.exception("NLP classification failed: %s", exc)
        return Classification(type="unknown", summary="", details={})

    msg_type = data.get("type", "unknown")
    if msg_type not in ("attendance", "incident", "question", "task", "unknown"):
        msg_type = "unknown"

    return Classification(
        type=msg_type,
        summary=str(data.get("summary", "")),
        details=data.get("details") or {},
    )
