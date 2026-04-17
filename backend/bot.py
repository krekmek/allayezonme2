import asyncio
import logging
import re

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
from db import (
    create_incident,
    create_staff,
    create_task,
    find_staff_by_fio,
    get_staff_by_id,
    get_staff_by_tg_id,
    list_staff,
)
from logic import find_substitution
from nlp_processor import classify_message

logging.basicConfig(level=logging.INFO)

ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Импersonation: real_tg_id -> staff_id, под которым «залогинен» пользователь.
# Хранится в памяти процесса, сбрасывается при перезапуске бота (это dev-фича).
IMPERSONATION: dict[int, int] = {}


async def get_current_staff(message: Message) -> dict | None:
    """Вернуть активный staff-профиль пользователя с учётом /login_as."""
    real_id = message.from_user.id
    impersonated = IMPERSONATION.get(real_id)
    if impersonated is not None:
        staff = await get_staff_by_id(impersonated)
        if staff is not None:
            return staff
        # Запись исчезла — снимаем имитацию
        IMPERSONATION.pop(real_id, None)
    return await get_staff_by_tg_id(real_id)


def current_tg_id_for_record(message: Message, staff: dict | None) -> int:
    """Какой telegram_id использовать при создании записей (incident/task).

    Если юзер залогинен под чужим аккаунтом, и у того есть telegram_id —
    используем его, чтобы запись выглядела как от имитируемого юзера.
    Иначе — реальный.
    """
    if staff and staff.get("telegram_id"):
        return int(staff["telegram_id"])
    return message.from_user.id

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
    waiting_specialization = State()


class CafeteriaReport(StatesGroup):
    waiting_text = State()


class AddStaff(StatesGroup):
    """FSM для создания «фейкового» сотрудника без Telegram-аккаунта."""
    waiting_fio = State()
    waiting_role = State()
    waiting_specialization = State()


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

    await state.update_data(role=role)

    # Учителю нужна специализация (предмет) — иначе find_substitution не работает.
    if role == ROLE_TEACHER:
        await query.message.edit_text(
            "Укажите ваш <b>предмет</b> (специализацию) одним словом или фразой,\n"
            "например: <i>математика</i>, <i>русский язык</i>, <i>физика</i>.\n\n"
            "Напишите его следующим сообщением:"
        )
        await state.set_state(Registration.waiting_specialization)
        await query.answer()
        return

    # Для admin/cafeteria сохраняем сразу без специализации
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


@dp.message(Registration.waiting_specialization, F.text)
async def handle_specialization(message: Message, state: FSMContext) -> None:
    specialization = message.text.strip()
    if len(specialization) < 2:
        await message.answer("Слишком коротко. Укажите предмет:")
        return

    data = await state.get_data()
    fio = data.get("fio", "").strip()
    role = data.get("role", ROLE_TEACHER)

    try:
        await create_staff(
            fio=fio,
            role=role,
            telegram_id=message.from_user.id,
            specialization=specialization,
        )
    except Exception as exc:  # noqa: BLE001
        logging.exception("Failed to create staff")
        await message.answer(f"Ошибка при сохранении: {exc}")
        await state.clear()
        return

    await state.clear()
    await message.answer(
        f"Регистрация завершена!\n"
        f"<b>{fio}</b> — <i>{ROLE_LABELS[role]}</i>\n"
        f"Предмет: <i>{specialization}</i>\n\n"
        "Используйте /start для списка команд."
    )


# ---------------------- /report (только для учителей) ----------------------

@dp.message(Command("report"))
async def handle_report_start(message: Message, state: FSMContext) -> None:
    staff = await get_current_staff(message)

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
        staff = await get_current_staff(message)
        await create_incident(
            description=text,
            created_by_tg_id=current_tg_id_for_record(message, staff),
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
    current_staff = await get_current_staff(message)
    creator_tg_id = current_tg_id_for_record(message, current_staff)

    result = await classify_message(text)
    msg_type = result["type"]
    summary = result["summary"] or text.strip()
    details = result["details"] or {}
    logging.info(
        "NLP result: type=%s source=%s text=%r details=%s creator_tg=%s",
        msg_type, source, text, details, creator_tg_id,
    )

    if msg_type == "incident":
        location = details.get("location") or "не указано"
        issue = details.get("issue") or summary
        try:
            incident = await create_incident(
                description=issue,
                created_by_tg_id=creator_tg_id,
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
        raw_due = details.get("due_date")

        # LLM иногда возвращает due_date текстом ("пятница") вместо ISO —
        # в таком случае не пытаемся засунуть это в DATE, сохраняем в описании.
        due_date: str | None = None
        if isinstance(raw_due, str) and ISO_DATE_RE.match(raw_due):
            due_date = raw_due
        elif isinstance(raw_due, str) and raw_due.strip():
            title = f"{title} (срок: {raw_due})"

        try:
            task = await create_task(
                description=title,
                created_by_tg_id=creator_tg_id,
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

    if msg_type == "substitution":
        await _handle_substitution(message, details)
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


async def _handle_substitution(message: Message, details: dict) -> None:
    """Обработать NLP-запрос на поиск замены учителю."""
    absent_fio = (details.get("absent_fio") or "").strip()
    lesson_number = details.get("lesson_number")
    day_of_week = details.get("day_of_week")

    if not absent_fio:
        await message.answer(
            "Не понял, кого именно надо заменить. Уточните ФИО учителя."
        )
        return
    try:
        lesson_number = int(lesson_number)
    except (TypeError, ValueError):
        await message.answer("Не понял номер урока. Уточните (1–12).")
        return

    # Ищем отсутствующего в staff
    candidates_by_fio = await find_staff_by_fio(absent_fio)
    teachers = [s for s in candidates_by_fio if s.get("role") == "teacher"]
    if not teachers:
        await message.answer(
            f"Учитель с ФИО, похожим на <i>{absent_fio}</i>, не найден в базе."
        )
        return
    if len(teachers) > 1:
        opts = "\n".join(f"• {t['fio']} (id={t['id']})" for t in teachers)
        await message.answer(
            "Найдено несколько учителей — уточните:\n" + opts
        )
        return
    absent = teachers[0]

    try:
        day = int(day_of_week) if day_of_week is not None else None
        if day is not None and not (1 <= day <= 7):
            day = None
    except (TypeError, ValueError):
        day = None

    candidates = await find_substitution(
        absent_teacher_id=absent["id"],
        lesson_number=lesson_number,
        day_of_week=day,
    )

    header = (
        f"<b>Поиск замены</b>\n"
        f"Отсутствует: <i>{absent['fio']}</i>"
        f" (специализация: {absent.get('specialization') or '—'})\n"
        f"Урок: <i>{lesson_number}</i>"
        + (f", день недели: <i>{day}</i>" if day else "")
    )

    if not candidates:
        if not absent.get("specialization"):
            await message.answer(
                header
                + "\n\nУ учителя не заполнена специализация — "
                "подобрать эквивалентную замену нельзя."
            )
            return
        await message.answer(
            header + "\n\nПодходящих свободных учителей не найдено."
        )
        return

    lines = [header, "", "Кандидаты:"]
    for c in candidates:
        tg = c.get("telegram_id")
        tg_part = f" (tg_id: <code>{tg}</code>)" if tg else ""
        lines.append(f"• {c['fio']}{tg_part}")
    await message.answer("\n".join(lines))


# ---------------------- Свободный текст ----------------------

@dp.message(F.text & ~F.text.startswith("/"))
async def handle_free_text(message: Message, state: FSMContext) -> None:
    if await state.get_state() is not None:
        return

    staff = await get_current_staff(message)
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

    staff = await get_current_staff(message)
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


# ---------------------- DEV: имитация другого пользователя ----------------------

@dp.message(Command("whoami"))
async def handle_whoami(message: Message) -> None:
    real_id = message.from_user.id
    staff = await get_current_staff(message)
    impersonating = IMPERSONATION.get(real_id)

    if staff is None:
        await message.answer(
            f"Ваш tg_id: <code>{real_id}</code>\n"
            "Вы не зарегистрированы — нажмите /start."
        )
        return

    role_label = ROLE_LABELS.get(staff.get("role"), staff.get("role"))
    specialization = staff.get("specialization") or "—"
    lines = [
        f"Ваш tg_id: <code>{real_id}</code>",
        f"Активный профиль: <b>{staff['fio']}</b> (id={staff['id']})",
        f"Роль: <i>{role_label}</i>",
        f"Предмет: <i>{specialization}</i>",
    ]
    if impersonating is not None:
        lines.append(
            f"\n⚠️ Вы <b>залогинены как другой пользователь</b> (/logout для выхода)."
        )
    await message.answer("\n".join(lines))


@dp.message(Command("logout"))
async def handle_logout(message: Message) -> None:
    real_id = message.from_user.id
    if IMPERSONATION.pop(real_id, None) is None:
        await message.answer("Вы и так под своим аккаунтом.")
        return
    await message.answer("Имитация снята, вы снова в своём профиле.")


@dp.message(Command("login_as"))
async def handle_login_as(message: Message, state: FSMContext) -> None:
    """Показать список сотрудников + кнопку создания нового."""
    await state.clear()
    all_staff = await list_staff()

    rows: list[list[InlineKeyboardButton]] = [
        [InlineKeyboardButton(
            text="➕ Создать нового сотрудника",
            callback_data="add_staff:start",
        )]
    ]
    for s in all_staff:
        role_label = ROLE_LABELS.get(s.get("role"), s.get("role") or "?")
        label = f"{s['fio']} · {role_label}"
        if len(label) > 60:
            label = label[:57] + "…"
        rows.append([
            InlineKeyboardButton(text=label, callback_data=f"impersonate:{s['id']}")
        ])

    kb = InlineKeyboardMarkup(inline_keyboard=rows)
    await message.answer(
        "Выберите, под кем залогиниться (dev-режим),\n"
        "или создайте нового сотрудника:",
        reply_markup=kb,
    )


# ---------- Создание нового сотрудника (dev, без telegram_id) ----------

@dp.callback_query(F.data == "add_staff:start")
async def handle_add_staff_start(query: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(AddStaff.waiting_fio)
    await query.message.edit_text(
        "Создание нового сотрудника.\n\n"
        "Введите <b>ФИО</b> (или /cancel для отмены):"
    )
    await query.answer()


@dp.message(AddStaff.waiting_fio, F.text)
async def handle_add_staff_fio(message: Message, state: FSMContext) -> None:
    fio = message.text.strip()
    if len(fio) < 3:
        await message.answer("ФИО слишком короткое. Попробуйте ещё раз:")
        return
    await state.update_data(fio=fio)
    await message.answer("Выберите роль:", reply_markup=role_keyboard())
    await state.set_state(AddStaff.waiting_role)


@dp.callback_query(AddStaff.waiting_role, F.data.startswith("role:"))
async def handle_add_staff_role(query: CallbackQuery, state: FSMContext) -> None:
    role = query.data.split(":", 1)[1]
    if role not in ROLE_LABELS:
        await query.answer("Неизвестная роль", show_alert=True)
        return
    await state.update_data(role=role)

    if role == ROLE_TEACHER:
        await query.message.edit_text(
            "Укажите <b>предмет</b> (специализацию) следующим сообщением:"
        )
        await state.set_state(AddStaff.waiting_specialization)
        await query.answer()
        return

    # admin / cafeteria — сохраняем сразу
    await _finalize_add_staff(query.message, state, specialization=None)
    await query.answer()


@dp.message(AddStaff.waiting_specialization, F.text)
async def handle_add_staff_specialization(message: Message, state: FSMContext) -> None:
    specialization = message.text.strip()
    if len(specialization) < 2:
        await message.answer("Слишком коротко. Укажите предмет:")
        return
    await _finalize_add_staff(message, state, specialization=specialization)


async def _finalize_add_staff(
    target: Message,
    state: FSMContext,
    *,
    specialization: str | None,
) -> None:
    """Общая часть: сохранить сотрудника в staff и сообщить об этом."""
    data = await state.get_data()
    fio = data.get("fio", "").strip()
    role = data.get("role", "teacher")

    try:
        staff = await create_staff(
            fio=fio,
            role=role,
            telegram_id=None,  # фейковый сотрудник без привязки к чату
            specialization=specialization,
        )
    except Exception as exc:  # noqa: BLE001
        logging.exception("Failed to add staff")
        await target.answer(f"Ошибка при создании: {exc}")
        await state.clear()
        return

    await state.clear()
    role_label = ROLE_LABELS.get(role, role)
    await target.answer(
        f"<b>Создан сотрудник</b>\n"
        f"ФИО: {fio}\n"
        f"Роль: <i>{role_label}</i>\n"
        f"Предмет: <i>{specialization or '—'}</i>\n"
        f"ID: <code>{staff.get('id')}</code>\n\n"
        f"Чтобы войти под ним — /login_as."
    )


@dp.callback_query(F.data.startswith("impersonate:"))
async def handle_impersonate_pick(query: CallbackQuery) -> None:
    try:
        staff_id = int(query.data.split(":", 1)[1])
    except (IndexError, ValueError):
        await query.answer("Некорректный выбор", show_alert=True)
        return

    staff = await get_staff_by_id(staff_id)
    if staff is None:
        await query.answer("Сотрудник не найден", show_alert=True)
        return

    IMPERSONATION[query.from_user.id] = staff_id
    role_label = ROLE_LABELS.get(staff.get("role"), staff.get("role"))
    await query.message.edit_text(
        f"Теперь вы действуете как <b>{staff['fio']}</b>\n"
        f"Роль: <i>{role_label}</i>\n"
        f"Предмет: <i>{staff.get('specialization') or '—'}</i>\n\n"
        "Команды /report, распознавание голоса и NLP-заявки будут создавать\n"
        "записи от этого имени. /logout — вернуться к себе."
    )
    await query.answer()


# ---------------------- entrypoint ----------------------

async def main() -> None:
    print("Бот запущен и готов к работе")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
