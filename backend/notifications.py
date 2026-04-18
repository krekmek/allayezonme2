"""Модуль для отправки уведомлений через Telegram."""
from __future__ import annotations

import logging
from typing import Any

from aiogram import Bot
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from config import settings
from db import get_staff_by_name

logger = logging.getLogger(__name__)

# Глобальный экземпляр бота (устанавливается в bot.py)
bot: Bot | None = None


def set_bot_instance(bot_instance: Bot) -> None:
    """Установить экземпляр бота для отправки уведомлений."""
    global bot
    bot = bot_instance


async def send_task_notification(task: dict[str, Any]) -> None:
    """Отправить уведомление о новой задаче с inline-кнопками."""
    global bot
    if not bot:
        logger.error("Bot instance not set for notifications")
        return

    assignee_name = task.get("assignee")
    if not assignee_name:
        return

    # Найти сотрудника по имени assignee
    staff = await get_staff_by_name(assignee_name)
    if not staff or not staff.get("telegram_id"):
        logger.warning(
            "Cannot send task notification: staff not found or no telegram_id for assignee=%s",
            assignee_name
        )
        return

    task_id = task.get("id")
    description = task.get("description", "")
    due_date = task.get("due_date")

    # Создаём inline-кнопки
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✅ Принял", callback_data=f"task:{task_id}:in_progress"),
            InlineKeyboardButton(text="❓ Нужна помощь", callback_data=f"task:{task_id}:help"),
        ],
        [
            InlineKeyboardButton(text="🎉 Выполнено", callback_data=f"task:{task_id}:done"),
        ],
    ])

    lines = [
        "<b>📋 Новая задача</b>",
        f"",
        f"{description}",
    ]
    if due_date:
        lines.append(f"Срок: <i>{due_date}</i>")
    lines.append("")
    lines.append("<i>Нажмите кнопку для изменения статуса:</i>")

    try:
        await bot.send_message(
            chat_id=staff["telegram_id"],
            text="\n".join(lines),
            reply_markup=keyboard,
            parse_mode="HTML"
        )
        logger.info(
            "Sent task notification to %s (tg_id=%s) for task %s",
            staff["fio"], staff["telegram_id"], task_id
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Failed to send task notification to %s", staff["fio"]
        )


async def send_substitution_notification(
    substitution_id: int,
    candidate: dict[str, Any],
    absent_teacher: dict[str, Any],
    lesson_number: int | None = None,
    class_name: str | None = None,
    subject: str | None = None,
    room: str | None = None,
    reason: str | None = None,
) -> bool:
    """Отправить учителю push-уведомление о назначении замены.
    Callback-кнопки используют substitution_id для идентификации записи.
    Возвращает True при успехе."""
    global bot
    if not bot:
        logger.error("Bot instance not set for notifications")
        return False

    tg_id = candidate.get("telegram_id")
    if not tg_id:
        logger.warning(
            "Cannot notify candidate %s: no telegram_id", candidate.get("fio")
        )
        return False

    absent_name = absent_teacher.get("fio", "коллега")

    # Текст по ТЗ: "Вам назначена замена в {класс} на {номер_урока} вместо {ФИО}. Подтвердите готовность."
    where = class_name or "—"
    lesson = str(lesson_number) if lesson_number else "—"
    lines = [
        "⚠️ <b>Внимание! Вам назначена замена</b>",
        "",
        f"Класс: <b>{where}</b>",
        f"Урок: <b>{lesson}</b>",
    ]
    if subject:
        lines.append(f"Предмет: {subject}")
    if room:
        lines.append(f"Кабинет: {room}")
    lines.append(f"Вместо: <b>{absent_name}</b>")
    if reason:
        lines.append(f"Причина: <i>{reason}</i>")
    lines.append("")
    lines.append("<i>Подтвердите готовность.</i>")

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="✅ Принять",
                callback_data=f"sub:confirm:{substitution_id}",
            ),
            InlineKeyboardButton(
                text="❌ Отклонить",
                callback_data=f"sub:decline:{substitution_id}",
            ),
        ],
    ])

    try:
        await bot.send_message(
            chat_id=tg_id,
            text="\n".join(lines),
            reply_markup=keyboard,
            parse_mode="HTML",
        )
        logger.info(
            "Sent substitution notification (id=%s) to %s (tg=%s) instead of %s",
            substitution_id, candidate.get("fio"), tg_id, absent_name,
        )
        return True
    except Exception:  # noqa: BLE001
        logger.exception(
            "Failed to send substitution notification to %s", candidate.get("fio")
        )
        return False
