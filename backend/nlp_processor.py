"""NLP-классификатор входящих сообщений на GPT-4o-mini.

Возвращает тип сообщения и извлечённые детали, чтобы бот мог маршрутизировать
ввод пользователя без явных команд.
"""
from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any, Literal, Optional, TypedDict

from openai import AsyncOpenAI

from config import settings

logger = logging.getLogger(__name__)

MessageType = Literal[
    "attendance", "incident", "question", "task", "substitution", "feeling_unwell", "duplicate_task", "unknown"
]


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

Входные сообщения могут быть на РУССКОМ или КАЗАХСКОМ языках. Тебе нужно:
1. Определить язык входного сообщения
2. Классифицировать сообщение по типу
3. Извлечь детали в стандартный JSON-формат (значения полей должны быть на русском языке)
4. Для attendance-отчётов на казахском: перевести названия классов (1А → 1А, 2Б → 2Б и т.д. остаются как есть, но ФИО транслитерировать в кириллицу)

Верни СТРОГО JSON-объект со следующими полями:
{
  "type": "attendance" | "incident" | "question" | "task" | "substitution" | "feeling_unwell" | "duplicate_task" | "unknown",
  "summary": "короткое резюме сообщения на русском (1 предложение)",
  "details": { ... произвольные извлечённые поля ... }
}

Правила классификации (проверяй в указанном порядке, первая подходящая категория — итоговая):

- "feeling_unwell" — учитель сообщает О СВОЁМ плохом самочувствии (первое лицо)
  Русский: "Я плохо себя чувствую", "Мне нездоровится", "Температура поднялась", "Заболел"
  Казахский: "Мені нашар сезінемін", "Денсаулығым бұзылды", "Температура көтерілді"
  КЛЮЧЕВОЙ ПРИЗНАК: сообщение от первого лица о самочувствии.
  В details извлекай: severity (лёгкое/среднее/тяжёлое, если можно оценить).

- "attendance" — отчёт по посещаемости детей/класса (НЕ о самочувствии учителя!)
  Русский: "В 5А отсутствуют Иванов и Петров", "все на месте", "болеет 3 человека"
  Казахский: "1А - 20 бала, 2 ауырып калды", "барлығы орнда", "3 бала ауырып жатыр"
  В details извлекай: class_name (название класса, например: "5А", "1А" — оставляем как есть),
  absent (список ФИО отсутствующих, транслитерировать казахские имена в кириллицу),
  present_count (число присутствующих, если указано).

- "incident" — жалоба на поломку, проблему с инфраструктурой, ЧП
  Русский: "в 203 кабинете течёт кран", "не работает проектор", "разбито окно"
  Казахский: "203 кабинетте кран ағып жатыр", "проектор жұмыс істемейді", "терезе сынды"
  В details извлекай: location (место), issue (суть проблемы).

- "task" — поручение, задача, распоряжение (часто от директора)
  Русский: "завтра провести педсовет в 15:00", "Иванову подготовить отчёт к пятнице"
  Казахский: "ертең сағат 15:00 педагогикалық кеңес өткізу", "Ивановға жұмаға есеп дайындау"
  В details извлекай: assignee (кому поручено), due_date (срок в формате YYYY-MM-DD),
  title (краткая формулировка на русском).

- "substitution" — запрос на поиск замены отсутствующему учителю
  Русский: "Иванов заболел, кто заменит 3-й урок?", "найди замену Петровой на 2 урок"
  Казахский: "Иванов ауырып қалды, 3-сабақты кім алмастырады?", "Петрованың 2-сабағына орнын табу"
  В details извлекай: absent_fio (ФИО отсутствующего), lesson_number (число 1-12),
  day_of_week (число 1-7: пн=1, вт=2, ..., вс=7; либо null).

- "question" — вопрос к школе/администрации/учителям
  Русский: "когда родительское собрание?", "где расписание?"
  Казахский: "ата-ана жиыны қашан?", "кесте қайда?"
  В details извлекай: topic (тема вопроса на русском).

- "duplicate_task" — запрос на дублирование предыдущей задачи
  Русский: "Сделай то же самое, что мы делали в прошлый четверг для 3А",
  "Повтори задачу от пятницы для 5Б", "Как в прошлый раз для 1А"
  Казахский: "Өткен сенбі 3А үшін не істеген болсаңыз, солай қайталаңыз",
  "5Б үшін жұманың тапсырмасын қайталаңыз"
  В details извлекай: reference_date (дата, на которую ссылаются, в формате YYYY-MM-DD или null),
  target_class (целевой класс, если указан, например: "3А"), target_date (новая дата, если указана).

- "unknown" — если не подходит ни под одну категорию.

ВАЖНО: Все значения в JSON (особенно в details) должны быть на РУССКОМ языке.
Казахские имена транслитерируй в кириллицу (например: "Ержан" → "Ержан", "Айнур" → "Айнур").

Отвечай только JSON, без пояснений и markdown-оборачивания."""


async def classify_message(text: str) -> Classification:
    """Классифицировать текст пользователя через GPT-4o-mini."""
    # Проверка наличия API ключа
    if not settings.GROQ_API_KEY or settings.GROQ_API_KEY == "":
        logger.warning("GROQ_API_KEY not configured, using fallback classification")
        return _fallback_classify(text)
    
    today = date.today()
    weekday_ru = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"][today.weekday()]
    system = (
        _SYSTEM_PROMPT
        + f"\n\nСегодня: {today.isoformat()} ({weekday_ru})."
        + " Используй эту дату как опорную, чтобы вычислить due_date из относительных"
        + " выражений (завтра, в пятницу, через неделю и т.п.)."
        + " due_date должна быть СТРОГО в формате YYYY-MM-DD либо null, если не вычисляется."
    )
    try:
        response = await _client.chat.completions.create(
            model=_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": text},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            timeout=30.0,  # Добавляем таймаут
        )
        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        logger.exception("NLP classification failed: %s, using fallback", exc)
        return _fallback_classify(text)

    msg_type = data.get("type", "unknown")
    if msg_type not in ("attendance", "incident", "question", "task", "substitution", "feeling_unwell", "duplicate_task", "unknown"):
        msg_type = "unknown"

    return Classification(
        type=msg_type,
        summary=str(data.get("summary", "")),
        details=data.get("details") or {},
    )


def _fallback_classify(text: str) -> Classification:
    """Резервная классификация на основе ключевых слов."""
    text_lower = text.lower()
    
    # Простые эвристики
    if any(kw in text_lower for kw in ["болею", "заболел", "нездоровится", "плохо себя чувствую"]):
        return Classification(type="feeling_unwell", summary="Сообщение о самочувствии", details={})
    
    if any(kw in text_lower for kw in ["отсутствуют", "болеет", "присутств", "детей", "бала"]):
        return Classification(type="attendance", summary="Отчёт по посещаемости", details={})
    
    if any(kw in text_lower for kw in ["сломал", "течёт", "не работает", "проблема", "инцидент"]):
        return Classification(type="incident", summary="Инцидент или поломка", details={})
    
    if any(kw in text_lower for kw in ["замена", "подмени", "замени"]):
        return Classification(type="substitution", summary="Запрос замены", details={})
    
    if any(kw in text_lower for kw in ["сделай", "подготовь", "организуй", "закажи"]):
        return Classification(type="task", summary="Задача или поручение", details={})
    
    if any(kw in text_lower for kw in ["когда", "где", "как", "почему"]):
        return Classification(type="question", summary="Вопрос", details={})
    
    return Classification(type="unknown", summary="Неизвестный тип сообщения", details={})


class AttendanceData(TypedDict):
    class_name: Optional[str]
    present: Optional[int]
    absent: Optional[int]


_ATTENDANCE_SYSTEM_PROMPT = """Ты — ассистент школы. Извлеки данные о посещаемости из свободного текста.
Верни ТОЛЬКО JSON: {"class_name": string, "present": number, "absent": number}.
Если в тексте нет данных о детях, верни null.

Примеры:
- "1А сегодня 20 деток, двое дома" → {"class_name": "1А", "present": 20, "absent": 2}
- "в 3Б все на месте, 25 человек" → {"class_name": "3Б", "present": 25, "absent": 0}
- "привет как дела" → null

Отвечай только JSON, без пояснений."""


async def extract_attendance_data(text: str) -> Optional[AttendanceData]:
    """Извлечь данные о посещаемости через GPT-4o-mini."""
    # Проверка наличия API ключа
    if not settings.GROQ_API_KEY or settings.GROQ_API_KEY == "":
        logger.warning("GROQ_API_KEY not configured, using fallback extraction")
        return _fallback_extract_attendance(text)
    
    try:
        response = await _client.chat.completions.create(
            model=_MODEL,
            messages=[
                {"role": "system", "content": _ATTENDANCE_SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            timeout=30.0,  # Добавляем таймаут
        )
        raw = response.choices[0].message.content or "null"
        if raw.strip().lower() == "null":
            return None
        
        data = json.loads(raw)
        
        return AttendanceData(
            class_name=data.get("class_name"),
            present=data.get("present"),
            absent=data.get("absent"),
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Attendance extraction failed: %s, using fallback", exc)
        return _fallback_extract_attendance(text)


def _fallback_extract_attendance(text: str) -> Optional[AttendanceData]:
    """Резервное извлечение данных о посещаемости на основе регулярных выражений."""
    import re
    
    # Ищем класс (например, 1А, 5Б)
    class_match = re.search(r'\d+[А-Яа-яA-Za-z]', text)
    class_name = class_match.group(0).upper() if class_match else None
    
    # Ищем числа
    numbers = re.findall(r'\d+', text)
    
    present = None
    absent = None
    
    if len(numbers) >= 2:
        # Если есть два числа, первое - присутствующие, второе - отсутствующие
        present = int(numbers[0])
        absent = int(numbers[1])
    elif len(numbers) == 1:
        # Если одно число, это либо присутствующие, либо отсутствующие
        # Проверяем контекст
        if "отсутств" in text.lower() or "боле" in text.lower() or "ауырып" in text.lower():
            absent = int(numbers[0])
        else:
            present = int(numbers[0])
    
    if class_name:
        return AttendanceData(
            class_name=class_name,
            present=present,
            absent=absent,
        )
    
    return None
