import asyncio
import logging

from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

from audio import transcribe_ogg
from config import settings
from db import create_incident, create_staff, create_task, get_staff_by_tg_id
from nlp_processor import classify_message

logging.basicConfig(level=logging.INFO)

bot = Bot(
    token=settings.TELEGRAM_BOT_TOKEN,
    default=DefaultBotProperties(parse_mode=ParseMode.HTML),
)
dp = Dispatcher(storage=MemoryStorage())


# ---------------------- Константы ролей ----------------------

ROLE_TEACHER = "teacher"
ROLE_ADMIN = "admin"
ROLE_CAFETERIA = "cafeteria"

ROLE_LABELS: dict[str, str] = {
    ROLE_TEACHER: "Учитель",
    ROLE_ADMIN: "Администратор",
    ROLE_CAFETERIA: "Работник столовой",
}


def role_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=label, callback_data=f"role:{key}")]
            for key, label in ROLE_LABELS.items()
        ]
    )


# ---------------------- FSM ----------------------

class Registration(StatesGroup):
    waiting_fio = State()
    waiting_role = State()


class CafeteriaReport(StatesGroup):
    waiting_text = State()


# ---------------------- /start + регистрация ----------------------

@dp.message(CommandStart())
async def handle_start(message: Message, state: FSMContext) -> None:
    await state.clear()
    tg_id = message.from_user.id

    staff = await get_staff_by_tg_id(tg_id)
    if staff is not None:
        role_label = ROLE_LABELS.get(staff["role"], staff["role"])
        await message.answer(
            f"С возвращением, <b>{staff['fio']}</b>!\n"
            f"Ваша роль: <i>{role_label}</i>.\n\n"
            "Команды:\n"
            "/report — отправить отчёт по столовой (только учителя)"
        )
        return

    await message.answer(
        "Привет! Вы ещё не зарегистрированы.\n"
        "Введите ваше <b>ФИО</b> (например: <i>Иванов Иван Иванович</i>):"
    )
    await state.set_state(Registration.waiting_fio)


@dp.message(Registration.waiting_fio, F.text)
async def handle_fio(message: Message, state: FSMContext) -> None:
    fio = message.text.strip()
    if len(fio) < 3:
        await message.answer("ФИО слишком короткое. Попробуйте ещё раз:")
        return

    await state.update_data(fio=fio)
    await message.answer("Выберите вашу роль:", reply_markup=role_keyboard())
    await state.set_state(Registration.waiting_role)


@dp.callback_query(Registration.waiting_role, F.data.startswith("role:"))
async def handle_role_choice(query: CallbackQuery, state: FSMContext) -> None:
    role = query.data.split(":", 1)[1]
    if role not in ROLE_LABELS:
        await query.answer("Неизвестная роль", show_alert=True)
        return

    data = await state.get_data()
    fio = data.get("fio", "").strip()

    try:
        await create_staff(fio=fio, role=role, telegram_id=query.from_user.id)
    except Exception as exc:  # noqa: BLE001
        logging.exception("Failed to create staff")
        await query.message.edit_text(f"Ошибка при сохранении: {exc}")
        await state.clear()
        return

    await state.clear()
    await query.message.edit_text(
        f"Регистрация завершена!\n"
        f"<b>{fio}</b> — <i>{ROLE_LABELS[role]}</i>\n\n"
        "Используйте /start для списка команд."
    )
    await query.answer()


# ---------------------- /report (только для учителей) ----------------------

@dp.message(Command("report"))
async def handle_report_start(message: Message, state: FSMContext) -> None:
    staff = await get_staff_by_tg_id(message.from_user.id)

    if staff is None:
        await message.answer(
            "Вы не зарегистрированы. Нажмите /start для регистрации."
        )
        return

    if staff["role"] != ROLE_TEACHER:
        await message.answer(
            "Отчёты по столовой могут отправлять только <b>учителя</b>."
        )
        return

    await message.answer(
        "Напишите текст отчёта по столовой одним сообщением "
        "(или /cancel для отмены):"
    )
    await state.set_state(CafeteriaReport.waiting_text)


@dp.message(Command("cancel"))
async def handle_cancel(message: Message, state: FSMContext) -> None:
    current = await state.get_state()
    if current is None:
        await message.answer("Нечего отменять.")
        return
    await state.clear()
    await message.answer("Действие отменено.")


@dp.message(CafeteriaReport.waiting_text, F.text)
async def handle_report_text(message: Message, state: FSMContext) -> None:
    text = message.text.strip()
    if not text:
        await message.answer("Пустой текст. Попробуйте ещё раз:")
        return

    try:
        await create_incident(
            description=text,
            created_by_tg_id=message.from_user.id,
            location="столовая",
        )
    except Exception as exc:  # noqa: BLE001
        logging.exception("Failed to create incident")
        await message.answer(f"Ошибка при сохранении отчёта: {exc}")
        await state.clear()
        return

    await state.clear()
    await message.answer("Отчёт принят. Спасибо!")


# ---------------------- NLP-маршрутизация (общая для текста и голоса) ----------------------

async def _route_classified(message: Message, text: str, *, source: str) -> None:
    """Классифицирует текст через NLP и создаёт запись в нужной таблице.

    source: "text" | "voice" — пробрасывается в tasks.source для отладки.
    """
    await bot.send_chat_action(message.chat.id, "typing")
    result = await classify_message(text)
    msg_type = result["type"]
    summary = result["summary"] or text.strip()
    details = result["details"] or {}

    if msg_type == "incident":
        location = details.get("location") or "не указано"
        issue = details.get("issue") or summary
        try:
            incident = await create_incident(
                description=issue,
                created_by_tg_id=message.from_user.id,
                location=str(location),
            )
        except Exception as exc:  # noqa: BLE001
            logging.exception("Failed to save incident")
            await message.answer(f"Не удалось сохранить заявку: {exc}")
            return
        await message.answer(
            "<b>Зафиксирована заявка</b>\n"
            f"Место: <i>{location}</i>\n"
            f"Проблема: {issue}\n"
            f"ID: <code>{incident.get('id')}</code>"
        )
        return

    if msg_type == "task":
        title = details.get("title") or summary
        assignee = details.get("assignee")
        due_date = details.get("due_date")
        try:
            task = await create_task(
                description=title,
                created_by_tg_id=message.from_user.id,
                assignee=assignee,
                due_date=due_date,
                source=source,
            )
        except Exception as exc:  # noqa: BLE001
            logging.exception("Failed to save task")
            await message.answer(f"Не удалось сохранить задачу: {exc}")
            return
        parts = [f"<b>Задача создана</b>", f"Описание: {title}"]
        if assignee:
            parts.append(f"Исполнитель: <i>{assignee}</i>")
        if due_date:
            parts.append(f"Срок: <i>{due_date}</i>")
        parts.append(f"ID: <code>{task.get('id')}</code>")
        await message.answer("\n".join(parts))
        return

    if msg_type == "attendance":
        class_name = details.get("class_name") or "не указан"
        absent = details.get("absent") or []
        absent_str = ", ".join(absent) if isinstance(absent, list) and absent else "—"
        await message.answer(
            "<b>Отчёт по посещаемости принят</b>\n"
            f"Класс: <i>{class_name}</i>\n"
            f"Отсутствуют: {absent_str}\n\n"
            "<i>(сохранение в БД будет добавлено позже)</i>"
        )
        return

    if msg_type == "question":
        topic = details.get("topic") or summary
        await message.answer(
            "Ваш вопрос принят. Мы передадим его администрации.\n"
            f"Тема: <i>{topic}</i>"
        )
        return

    # unknown
    await message.answer(
        "Не смог понять сообщение. Попробуйте переформулировать."
    )


# ---------------------- Свободный текст ----------------------

@dp.message(F.text & ~F.text.startswith("/"))
async def handle_free_text(message: Message, state: FSMContext) -> None:
    if await state.get_state() is not None:
        return

    staff = await get_staff_by_tg_id(message.from_user.id)
    if staff is None:
        await message.answer(
            "Вы не зарегистрированы. Нажмите /start для регистрации."
        )
        return

    await _route_classified(message, message.text, source="text")


# ---------------------- Голосовые сообщения ----------------------

@dp.message(F.voice)
async def handle_voice(message: Message, state: FSMContext) -> None:
    """Транскрибирует голосовое через Whisper и прогоняет текст через NLP."""
    if await state.get_state() is not None:
        # В FSM голосовые не принимаем, чтобы не путать шаги регистрации.
        await message.answer(
            "Сейчас идёт диалог — пришлите, пожалуйста, текст. "
            "Или /cancel для отмены."
        )
        return

    staff = await get_staff_by_tg_id(message.from_user.id)
    if staff is None:
        await message.answer(
            "Вы не зарегистрированы. Нажмите /start для регистрации."
        )
        return

    await bot.send_chat_action(message.chat.id, "record_voice")

    # Скачиваем файл голосового сообщения в память
    try:
        file = await bot.get_file(message.voice.file_id)
        buf = await bot.download_file(file.file_path)
        audio_bytes = buf.read() if buf is not None else b""
    except Exception as exc:  # noqa: BLE001
        logging.exception("Failed to download voice")
        await message.answer(f"Не удалось скачать голосовое: {exc}")
        return

    if not audio_bytes:
        await message.answer("Пустой файл голосового. Попробуйте ещё раз.")
        return

    await bot.send_chat_action(message.chat.id, "typing")
    text = await transcribe_ogg(audio_bytes, language="ru")

    if not text:
        await message.answer(
            "Не удалось распознать речь. Попробуйте ещё раз или напишите текстом."
        )
        return

    await message.answer(f"<b>Распознано:</b>\n<i>{text}</i>")
    await _route_classified(message, text, source="voice")


# ---------------------- entrypoint ----------------------

async def main() -> None:
    print("Бот запущен и готов к работе")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
