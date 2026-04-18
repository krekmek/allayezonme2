import asyncio
import logging
import re
from typing import Any

from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart, StateFilter
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
from db import supabase
import notifications
from db import (
    add_teacher_points,
    create_absence,
    create_attendance_report,
    create_incident,
    create_staff,
    create_task,
    find_staff_by_fio,
    get_staff_by_id,
    get_staff_by_name,
    get_staff_by_tg_id,
    get_teacher_points,
    list_staff,
    search_tasks_by_date,
    update_task_status,
    upload_voice_note,
)
from logic import find_substitution, generate_tomorrow_substitution_draft
from nlp_processor import classify_message, extract_attendance_data
from main import start_scheduler

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


@dp.message(Command("help"))
async def handle_help(message: Message) -> None:
    """Показать список доступных команд."""
    staff = await get_current_staff(message)
    role = staff.get("role") if staff else None

    lines = [
        "<b>📋 Доступные команды</b>",
        "",
        "<b>Общие:</b>",
        "/start — регистрация или приветствие",
        "/help — показать этот список команд",
        "/whoami — информация о вашем профиле",
        "/cancel — отменить текущее действие",
        "",
    ]

    if role == ROLE_TEACHER:
        lines.extend([
            "<b>Для учителей:</b>",
            "/report — отправить отчёт по столовой",
            "/points — показать ваши очки оперативности",
            "",
        ])

    lines.extend([
        "<b>Свободный ввод:</b>",
        "• Напишите текстом или голосом:",
        "  — отчёт по посещаемости: <i>«1А сегодня 20, двое дома»</i>",
        "  — инцидент: <i>«в 203 кабинете течёт кран»</i>",
        "  — задача: <i>«завтра провести педсовет в 15:00»</i>",
        "  — замена: <i>«Иванов заболел, кто заменит 3-й урок?»</i>",
        "  — болезнь: <i>«я заболел»</i> — бот назначит замены",
        "",
        "<b>DEV-команды:</b>",
        "/login_as — войти как другой сотрудник",
        "/logout — выйти из имитации",
    ])

    await message.answer("\n".join(lines))


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

    await state.clear()
    # Прогоняем отчёт через NLP: он сохранит в attendance_reports, если это посещаемость.
    await _route_classified(message, text, source="report")


# ---------------------- NLP-маршрутизация (общая для текста и голоса) ----------------------

async def _route_classified(
    message: Message,
    text: str,
    *,
    source: str,
    audio_bytes: bytes | None = None,
) -> None:
    """Классифицирует текст через NLP и создаёт запись в нужной таблице.

    source: "text" | "voice" — пробрасывается в tasks.source для отладки.
    audio_bytes: байты аудио (для источника "voice") — чтобы загрузить в Storage.
    """
    await bot.send_chat_action(message.chat.id, "typing")
    current_staff = await get_current_staff(message)
    creator_tg_id = current_tg_id_for_record(message, current_staff)

    # Жёсткая проверка на фразы о плохом самочувствии или отсутствии (приоритет над NLP)
    text_lower = text.lower()
    unwell_phrases = [
        "я плохо себя чувствую",
        "мне нездоровится",
        "температура поднялась",
        "я заболел",
        "я заболела",
        "у меня температура",
        "плохо себя чувствую",
        "меня сегодня не будет",
        "меня не будет",
        "не смогу прийти",
        "не смогу выйти",
        "не приду сегодня",
    ]
    if any(phrase in text_lower for phrase in unwell_phrases):
        logging.info("Feeling unwell phrase detected, bypassing NLP: %r", text)
        await _handle_feeling_unwell(message, current_staff, reason_text=text, audio_bytes=audio_bytes)
        return

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
        
        # Отправляем уведомление исполнителю, если указан
        if assignee:
            await notifications.send_task_notification(task)
        
        return

    if msg_type == "attendance":
        class_name = details.get("class_name")
        absent = details.get("absent") or []
        if not isinstance(absent, list):
            absent = []
        absent = [str(x).strip() for x in absent if str(x).strip()]

        present_count = details.get("present_count")
        try:
            present_count = int(present_count) if present_count is not None else 0
        except (TypeError, ValueError):
            present_count = 0

        # Число порций = число присутствующих (если указано), иначе считаем по отсутствующим
        portions = present_count if present_count > 0 else max(0, present_count)

        try:
            report = await create_attendance_report(
                class_name=class_name,
                present_count=present_count,
                absent_count=len(absent),
                absent_list=absent,
                portions=portions,
                raw_text=text,
                created_by_tg_id=creator_tg_id,
            )
        except Exception as exc:  # noqa: BLE001
            logging.exception("Failed to save attendance report")
            await message.answer(f"Не удалось сохранить отчёт по посещаемости: {exc}")
            return

        # Начисляем очки за оперативность (до 09:00)
        if current_staff:
            from datetime import datetime
            now = datetime.now()
            if now.hour < 9:  # До 09:00
                try:
                    await add_teacher_points(current_staff["id"], points=1)
                    logging.info(
                        "Added promptness point to staff %s for report before 09:00",
                        current_staff["fio"]
                    )
                except Exception as exc:  # noqa: BLE001
                    logging.exception("Failed to add teacher points")

        absent_str = ", ".join(absent) if absent else "—"
        await message.answer(
            "<b>Отчёт по посещаемости сохранён</b>\n"
            f"Класс: <i>{class_name or 'не указан'}</i>\n"
            f"Присутствует: <b>{present_count}</b> (порций: {portions})\n"
            f"Отсутствуют: {absent_str}\n"
            f"ID: <code>{report.get('id')}</code>"
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

    if msg_type == "feeling_unwell":
        await _handle_feeling_unwell(message, current_staff, reason_text=text, audio_bytes=audio_bytes)
        return

    if msg_type == "duplicate_task":
        await _handle_duplicate_task(message, details, creator_tg_id)
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
        warnings = c.get("warnings", [])
        for warning in warnings:
            lines.append(f"  ⚠️ <b>{warning}</b>")
    await message.answer("\n".join(lines))


async def _handle_feeling_unwell(
    message: Message,
    staff: dict[str, Any] | None,
    *,
    reason_text: str | None = None,
    audio_bytes: bytes | None = None,
) -> None:
    """Обработать сообщение о плохом самочувствии учителя.
    
    Создаёт запись в таблице absences, загружает голос в Storage (если есть),
    уведомляет директора и назначает замены.
    """
    if not staff or staff.get("role") != ROLE_TEACHER:
        await message.answer(
            "Эта функция доступна только для учителей."
        )
        return

    # 1. Загружаем аудио в Storage (если есть)
    voice_url: str | None = None
    if audio_bytes:
        try:
            import time
            filename = f"absence_{staff['id']}_{int(time.time())}.ogg"
            voice_url = await upload_voice_note(
                audio_bytes=audio_bytes,
                filename=filename,
                content_type="audio/ogg",
            )
            logging.info("Voice uploaded for absence: %s", voice_url)
        except Exception:  # noqa: BLE001
            logging.exception("Failed to upload voice note")
    
    # 2. Создаём запись в absences
    try:
        absence = await create_absence(
            teacher_id=staff["id"],
            reason_text=reason_text,
            voice_url=voice_url,
        )
        logging.info("Absence created: %s", absence)
    except Exception:  # noqa: BLE001
        logging.exception("Failed to create absence record")

    await message.answer(
        "✅ <b>Уведомление отправлено директору</b>\n"
        "Генерирую черновик замен..."
    )

    try:
        draft = await generate_tomorrow_substitution_draft(staff["id"])
    except Exception as exc:  # noqa: BLE001
        logging.exception("Failed to generate substitution draft")
        await message.answer(f"Не удалось сгенерировать черновик: {exc}")
        return

    # Ищем директора или администратора
    director_resp = (
        supabase.table("staff")
        .select("*")
        .in_("role", ["director", "admin"])
        .execute()
    )
    directors = director_resp.data or []

    if not directors:
        await message.answer(
            "Черновик замен готов, но в системе не найден директор для отправки."
        )
        return

    # Формируем сообщение для директора
    teacher_name = staff.get("fio", "Учитель")
    draft_date = draft.get("date", "завтра")
    day_names = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    dow_name = day_names[(draft.get("day_of_week", 1) - 1) % 7]
    
    lines = [
        f"🚨 <b>Предупреждение: возможное отсутствие</b>",
        f"",
        f"Учитель: <b>{teacher_name}</b>",
        f"Сообщил: плохо себя чувствует",
        f"Дата: {draft_date} ({dow_name})",
        f"",
        f"<b>Черновик замен:</b>",
    ]

    substitutions = draft.get("substitutions", [])
    assigned_subs: list[dict[str, Any]] = []  # для push-уведомлений
    
    if not substitutions:
        lines.append("На завтра у учителя нет уроков.")
    else:
        for sub in substitutions:
            lesson_num = sub.get("lesson_number")
            class_name = sub.get("class_name")
            room = sub.get("room")
            subject = sub.get("subject")
            candidates = sub.get("candidates", [])
            
            lines.append(f"")
            lines.append(f"Урок {lesson_num}: {class_name}, каб. {room} — {subject}")
            
            if candidates:
                # Выбираем ЛУЧШЕГО кандидата: того у кого нет предупреждений
                best = next(
                    (c for c in candidates if not c.get("warnings")),
                    candidates[0],  # fallback - первый из списка
                )
                warnings = best.get("warnings", [])
                warning_text = f" ({', '.join(warnings)})" if warnings else ""
                lines.append(f"  ✅ Назначен: <b>{best['fio']}</b>{warning_text}")
                
                assigned_subs.append({
                    "candidate": best,
                    "lesson_number": lesson_num,
                    "class_name": class_name,
                    "room": room,
                    "subject": subject,
                })
            else:
                lines.append("  ⚠️ Нет подходящих кандидатов")

    lines.append("")
    lines.append("<i>Замены назначены автоматически. Кандидаты получили push-уведомления.</i>")

    # Отправляем директору
    for director in directors:
        director_tg_id = director.get("telegram_id")
        if director_tg_id:
            try:
                await bot.send_message(
                    chat_id=director_tg_id,
                    text="\n".join(lines),
                    parse_mode="HTML"
                )
                logging.info(
                    "Sent substitution draft to director %s for teacher %s",
                    director["fio"], teacher_name
                )
            except Exception as exc:  # noqa: BLE001
                logging.exception(
                    "Failed to send message to director %s", director["fio"]
                )

    # Отправляем push-уведомления назначенным кандидатам
    teacher_short_name = teacher_name.split()[0] if teacher_name else "коллеги"
    notified_count = 0
    for assigned in assigned_subs:
        cand = assigned["candidate"]
        cand_tg_id = cand.get("telegram_id")
        if not cand_tg_id:
            logging.warning(
                "Cannot notify candidate %s: no telegram_id", cand.get("fio")
            )
            continue
        
        notification_text = (
            f"📢 <b>Вам назначена замена</b>\n\n"
            f"Класс: <b>{assigned['class_name']}</b>\n"
            f"Урок: <b>{assigned['lesson_number']}</b>\n"
            f"Предмет: {assigned['subject']}\n"
            f"Кабинет: {assigned['room']}\n"
            f"Дата: {draft_date} ({dow_name})\n"
            f"Вместо: <b>{teacher_short_name}</b>\n\n"
            f"<i>Подтвердите получение.</i>"
        )
        try:
            await bot.send_message(
                chat_id=cand_tg_id,
                text=notification_text,
                parse_mode="HTML",
            )
            notified_count += 1
            logging.info(
                "Sent substitution notification to %s for lesson %s",
                cand["fio"], assigned["lesson_number"]
            )
        except Exception:  # noqa: BLE001
            logging.exception(
                "Failed to notify candidate %s", cand.get("fio")
            )

    await message.answer(
        "<b>Готово!</b>\n"
        f"Черновик замен отправлен директору.\n"
        f"Уведомления получили: {notified_count} чел."
    )


async def _handle_duplicate_task(
    message: Message,
    details: dict[str, Any],
    creator_tg_id: int,
) -> None:
    """Обработать запрос на дублирование предыдущей задачи."""
    reference_date = details.get("reference_date")
    target_class = details.get("target_class")
    target_date = details.get("target_date")

    await message.answer(
        "<b>Ищу предыдущую задачу...</b>"
    )

    # Ищем задачи по дате
    tasks = await search_tasks_by_date(
        date_str=reference_date,
        created_by_tg_id=creator_tg_id,
        limit=5,
    )

    if not tasks:
        await message.answer(
            f"Не найдено задач за указанную дату{f' ({reference_date})' if reference_date else ''}."
        )
        return

    # Берём последнюю задачу
    original_task = tasks[0]
    original_description = original_task.get("description", "")
    original_assignee = original_task.get("assignee")

    # Формируем новое описание с обновлением класса
    new_description = original_description
    if target_class:
        # Заменяем классы в описании (например, 3А → 5Б)
        import re
        class_pattern = r'\d+[А-Яа-яA-Za-z]'
        if re.search(class_pattern, original_description):
            new_description = re.sub(class_pattern, target_class, original_description)

    # Если указана новая дата, используем её, иначе вычисляем на основе reference_date
    new_due_date = target_date
    if not new_due_date and reference_date:
        # Если указана только ссылочная дата, вычисляем новую дату (например, +1 неделя)
        try:
            from datetime import datetime, timedelta
            ref_dt = datetime.strptime(reference_date, "%Y-%m-%d")
            # Добавляем 7 дней (предполагаем, что "то же самое" значит "на следующей неделе")
            new_dt = ref_dt + timedelta(days=7)
            new_due_date = new_dt.strftime("%Y-%m-%d")
        except Exception:  # noqa: BLE001
            pass

    try:
        new_task = await create_task(
            description=new_description,
            created_by_tg_id=creator_tg_id,
            assignee=original_assignee,
            due_date=new_due_date,
            source="text",
        )
    except Exception as exc:  # noqa: BLE001
        logging.exception("Failed to create duplicate task")
        await message.answer(f"Не удалось создать дубликат задачи: {exc}")
        return

    lines = [
        "<b>Задача продублирована</b>",
        f"Описание: {new_description}",
    ]
    if original_assignee:
        lines.append(f"Исполнитель: <i>{original_assignee}</i>")
    if new_due_date:
        lines.append(f"Срок: <i>{new_due_date}</i>")
    lines.append(f"ID: <code>{new_task.get('id')}</code>")
    lines.append("")
    lines.append(f"Оригинал (ID {original_task.get('id')}): {original_description}")

    await message.answer("\n".join(lines))


# ---------------------- Callback-кнопки для задач ----------------------

@dp.callback_query(F.data.startswith("task:"))
async def handle_task_callback(query: CallbackQuery) -> None:
    """Обработать нажатие на кнопку задачи."""
    try:
        _, task_id_str, action = query.data.split(":")
        task_id = int(task_id_str)
    except (ValueError, IndexError):
        await query.answer("Некорректные данные", show_alert=True)
        return

    # Определяем новый статус
    status_map = {
        "in_progress": "in_progress",
        "help": "in_progress",  # "Нужна помощь" тоже переводит в "В работе"
        "done": "done",
    }
    new_status = status_map.get(action)
    if not new_status:
        await query.answer("Неизвестное действие", show_alert=True)
        return

    # Обновляем статус в базе
    updated = await update_task_status(task_id, new_status)
    if not updated:
        await query.answer("Не удалось обновить статус", show_alert=True)
        return

    # Обновляем кнопки (скрываем нажатую)
    if action == "done":
        # Если выполнено - убираем все кнопки
        await query.message.edit_reply_markup(reply_markup=None)
        await query.answer("Задача отмечена как выполнена ✅")
    else:
        # Иначе обновляем текст кнопки
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton(text="✅ Принято", callback_data=f"task:{task_id}:accepted"),
                InlineKeyboardButton(text="❓ Нужна помощь", callback_data=f"task:{task_id}:help"),
            ],
            [
                InlineKeyboardButton(text="🎉 Выполнено", callback_data=f"task:{task_id}:done"),
            ],
        ])
        await query.message.edit_reply_markup(reply_markup=keyboard)
        status_text = "Принято в работу" if action == "in_progress" else "Запрошена помощь"
        await query.answer(f"Статус: {status_text}")

    logging.info(
        "Task %s status updated to %s by user %s",
        task_id, new_status, query.from_user.id
    )


# ---------------------- Свободный текст ----------------------

@dp.message(StateFilter(None), F.text & ~F.text.startswith("/"))
async def handle_free_text(message: Message, state: FSMContext) -> None:
    staff = await get_current_staff(message)
    if staff is None:
        await message.answer(
            "Вы не зарегистрированы. Нажмите /start для регистрации."
        )
        return

    # Сначала пробуем извлечь данные о посещаемости через GPT-4o-mini
    await bot.send_chat_action(message.chat.id, "typing")
    
    attendance_data = await extract_attendance_data(message.text)
    
    if attendance_data and attendance_data.get("class_name"):
        # Если извлечены данные о посещаемости - сохраняем в БД
        class_name = attendance_data["class_name"]
        present = attendance_data.get("present") or 0
        absent = attendance_data.get("absent") or 0
        
        try:
            await create_attendance_report(
                class_name=class_name,
                present_count=present,
                absent_count=absent,
                absent_list=[],
                portions=present,
                raw_text=message.text,
                created_by_tg_id=message.from_user.id,
            )
            await message.answer(
                f"✅ Отчёт по столовой сохранён:\n"
                f"Класс: {class_name}\n"
                f"Присутствует: {present}\n"
                f"Отсутствует: {absent}"
            )
        except Exception as exc:  # noqa: BLE001
            logging.exception("Failed to save attendance report")
            await message.answer(f"Ошибка при сохранении отчёта: {exc}")
        return
    
    # Если не удалось извлечь данные о посещаемости - используем старую логику
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
    await _route_classified(message, text, source="voice", audio_bytes=audio_bytes)


# ---------------------- DEV: имитация другого пользователя ----------------------

@dp.message(Command("points"))
async def handle_points(message: Message) -> None:
    """Показать очки оперативности учителя."""
    staff = await get_current_staff(message)
    if staff is None:
        await message.answer(
            "Вы не зарегистрированы. Нажмите /start для регистрации."
        )
        return

    if staff["role"] != ROLE_TEACHER:
        await message.answer(
            "Очки оперативности доступны только для учителей."
        )
        return

    points_data = await get_teacher_points(staff["id"])
    if not points_data:
        await message.answer(
            "У вас пока нет очков. Сдавайте отчёты по столовой до 09:00, чтобы получить очки!"
        )
        return

    lines = [
        "<b>🏆 Ваши очки оперативности</b>",
        f"",
        f"Очки: <b>{points_data.get('points', 0)}</b>",
        f"Отчётов до 09:00: {points_data.get('reports_before_09_count', 0)}",
    ]
    if points_data.get("last_report_at"):
        lines.append(f"Последний отчёт: {points_data['last_report_at']}")
    
    await message.answer("\n".join(lines))


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

async def set_bot_commands() -> None:
    """Зарегистрировать команды в меню Telegram."""
    from aiogram.types import BotCommand
    commands = [
        BotCommand(command="start", description="Регистрация / приветствие"),
        BotCommand(command="help", description="Список команд"),
        BotCommand(command="whoami", description="Мой профиль"),
        BotCommand(command="report", description="Отчёт по столовой"),
        BotCommand(command="points", description="Очки оперативности"),
        BotCommand(command="cancel", description="Отменить действие"),
        BotCommand(command="login_as", description="DEV: войти как сотрудник"),
        BotCommand(command="logout", description="DEV: выйти из имитации"),
    ]
    await bot.set_my_commands(commands)


async def main() -> None:
    print("Бот запущен и готов к работе")
    notifications.set_bot_instance(bot)
    start_scheduler()  # Запуск планировщика задач
    await set_bot_commands()
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
