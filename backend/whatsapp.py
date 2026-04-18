"""Twilio WhatsApp API клиент.

Используется как дублирующий канал к Telegram. Если креденшелы не заданы —
все функции становятся no-op и логируют предупреждение.

Документация: https://www.twilio.com/docs/whatsapp/api
Sandbox: https://console.twilio.com → Messaging → Try it out → Send a WhatsApp message
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from config import settings

logger = logging.getLogger(__name__)


def is_configured() -> bool:
    """True, если заданы Twilio креденшелы."""
    return bool(settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN)


def _api_url() -> str:
    return (
        f"https://api.twilio.com/2010-04-01/Accounts/"
        f"{settings.TWILIO_ACCOUNT_SID}/Messages.json"
    )


def _auth() -> tuple[str, str]:
    return (settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)


def normalize_phone(phone: str | None) -> str | None:
    """Приводим к формату Twilio WhatsApp: 'whatsapp:+77012345678'."""
    if not phone:
        return None
    s = str(phone).strip()
    if s.startswith("whatsapp:"):
        return s

    digits = "".join(ch for ch in s if ch.isdigit())
    if digits.startswith("8") and len(digits) == 11:
        digits = "7" + digits[1:]
    if not digits:
        return None
    return f"whatsapp:+{digits}"


# ---------------- Отправка ----------------

async def send_text(to_phone: str, text: str) -> bool:
    """Отправить обычный текст через Twilio WhatsApp.

    В sandbox-режиме работает только если получатель сделал
    `join <код>` боту Twilio со своего WhatsApp (1 раз)."""
    if not is_configured():
        logger.info("Twilio WhatsApp disabled (no credentials), skipping to %s", to_phone)
        return False

    to = normalize_phone(to_phone)
    if not to:
        return False

    data = {
        "From": settings.TWILIO_WHATSAPP_FROM,
        "To": to,
        "Body": text[:1600],  # лимит Twilio
    }
    return await _send(data, to_phone=to)


async def send_substitution_request(
    to_phone: str,
    substitution_id: int,
    *,
    class_name: str | None,
    lesson_number: int | None,
    absent_name: str,
    subject: str | None = None,
    room: str | None = None,
    reason: str | None = None,
) -> bool:
    """Отправить уведомление о замене с просьбой ответить 'да' или 'нет'.

    Twilio sandbox не поддерживает кнопки без одобрения шаблона.
    Поэтому просим пользователя ответить текстом '1' / '2' или 'да' / 'нет'."""
    where = class_name or "—"
    lesson = str(lesson_number) if lesson_number else "—"
    lines = [
        "⚠️ Внимание! Вам назначена замена",
        "",
        f"Класс: {where}",
        f"Урок: {lesson}",
    ]
    if subject:
        lines.append(f"Предмет: {subject}")
    if room:
        lines.append(f"Кабинет: {room}")
    lines.append(f"Вместо: {absent_name}")
    if reason:
        lines.append(f"Причина: {reason}")
    lines.append("")
    lines.append(f"Ответьте одним из вариантов:")
    lines.append(f"  ✅ ДА {substitution_id}  — принять")
    lines.append(f"  ❌ НЕТ {substitution_id}  — отклонить")

    return await send_text(to_phone, "\n".join(lines))


async def _send(data: dict[str, Any], *, to_phone: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(_api_url(), data=data, auth=_auth())
        if resp.status_code >= 400:
            logger.error(
                "Twilio WhatsApp send failed (%s) to %s: %s",
                resp.status_code, to_phone, resp.text[:500],
            )
            return False
        sid = resp.json().get("sid")
        logger.info("Twilio WhatsApp sent to %s (sid=%s)", to_phone, sid)
        return True
    except Exception:
        logger.exception("Twilio WhatsApp request error to %s", to_phone)
        return False


# ---------------- Парсинг входящего webhook (Twilio form-data) ----------------

def parse_incoming(form: dict[str, Any]) -> dict[str, Any]:
    """Разобрать входящее сообщение Twilio WhatsApp.

    Возвращает dict: {from_phone, body, button_action (confirm/decline/None), sub_id}"""
    from_phone = str(form.get("From", ""))  # "whatsapp:+77012345678"
    body = str(form.get("Body", "")).strip()

    result: dict[str, Any] = {
        "from_phone": from_phone,
        "body": body,
        "button_action": None,
        "sub_id": None,
    }

    # Пытаемся распарсить команды типа "ДА 123" или "да 123" или "1 123"
    import re
    m = re.match(r"^\s*(да|yes|y|1|принять|accept)\s+(\d+)\s*$", body, re.IGNORECASE)
    if m:
        result["button_action"] = "confirm"
        result["sub_id"] = int(m.group(2))
        return result

    m = re.match(r"^\s*(нет|no|n|2|отклонить|decline|reject)\s+(\d+)\s*$", body, re.IGNORECASE)
    if m:
        result["button_action"] = "decline"
        result["sub_id"] = int(m.group(2))
        return result

    return result
