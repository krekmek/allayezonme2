"""
Запланированные задачи для автоматизации школьных процессов.
Использует apscheduler для выполнения задач по расписанию.
"""
import asyncio
import logging
from datetime import datetime, date

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from config import settings
from db import supabase

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# Создаем планировщик
scheduler = AsyncIOScheduler()


async def get_attendance_for_date(target_date: date) -> list[dict]:
    """Получить все отчёты по посещаемости за указанную дату."""
    def _run():
        resp = (
            supabase.table("attendance_reports")
            .select("*")
            .gte("created_at", f"{target_date}T00:00:00")
            .lt("created_at", f"{target_date}T23:59:59")
            .execute()
        )
        return resp.data or []
    
    return await asyncio.to_thread(_run)


async def get_staff_by_role(role: str) -> list[dict]:
    """Получить сотрудников по роли."""
    def _run():
        resp = (
            supabase.table("staff")
            .select("*")
            .eq("role", role)
            .execute()
        )
        return resp.data or []
    
    return await asyncio.to_thread(_run)


async def get_all_classes() -> list[str]:
    """Получить список всех классов из расписания."""
    def _run():
        resp = (
            supabase.table("schedules")
            .select("class_name")
            .execute()
        )
        # Уникальные классы
        classes = set(item["class_name"] for item in (resp.data or []))
        return sorted(classes)
    
    return await asyncio.to_thread(_run)


async def send_telegram_message(chat_id: int, text: str) -> bool:
    """Отправить сообщение в Telegram."""
    try:
        from aiogram import Bot
        bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)
        await bot.send_message(chat_id=chat_id, text=text, parse_mode="HTML")
        await bot.session.close()
        return True
    except Exception as e:
        logger.error(f"Failed to send Telegram message: {e}")
        return False


async def daily_canteen_report() -> None:
    """
    Ежедневный отчёт по столовой в 09:00.
    
    Собирает все отчёты по посещаемости за текущую дату,
    подсчитывает итоговые порции и отправляет отчёт завстоловой.
    Если по каким-то классам нет данных — отправляет список должников директору.
    """
    logger.info("Запуск ежедневного отчёта по столовой...")
    
    today = date.today()
    reports = await get_attendance_for_date(today)
    
    # Группируем по классам
    class_reports: dict[str, dict] = {}
    for report in reports:
        class_name = report.get("class_name") or "Неизвестный класс"
        if class_name not in class_reports:
            class_reports[class_name] = {
                "present": 0,
                "portions": 0,
            }
        class_reports[class_name]["present"] += report.get("present_count", 0)
        class_reports[class_name]["portions"] += report.get("portions", 0)
    
    # Итого
    total_present = sum(r["present"] for r in class_reports.values())
    total_portions = sum(r["portions"] for r in class_reports.values())
    
    # Получаем список всех классов и находим должников
    all_classes = await get_all_classes()
    missing_classes = [cls for cls in all_classes if cls not in class_reports]
    
    # Формируем отчёт для завстоловой
    report_lines = [
        f"📊 <b>Отчёт по столовой на {today.strftime('%d.%m.%Y')}</b>",
        "",
        f"Всего отчётов: {len(reports)}",
        f"Всего порций: <b>{total_portions}</b>",
        f"Присутствует: {total_present}",
        "",
        "<b>По классам:</b>",
    ]
    
    for class_name in sorted(class_reports.keys()):
        data = class_reports[class_name]
        report_lines.append(f"  • {class_name}: {data['portions']} порций ({data['present']} чел.)")
    
    report_text = "\n".join(report_lines)
    
    # Отправляем завстоловой
    try:
        # Ищем завхоз/завстоловую (role = 'canteen_manager' или похожее)
        canteen_staff = await get_staff_by_role("canteen_manager")
        if not canteen_staff:
            canteen_staff = await get_staff_by_role("admin")
        
        if canteen_staff and canteen_staff[0].get("telegram_id"):
            await send_telegram_message(canteen_staff[0]["telegram_id"], report_text)
            logger.info(f"Отчёт отправлен завстоловой: {canteen_staff[0]['fio']}")
        else:
            logger.warning("Не найден завхоз с telegram_id")
    except Exception as e:
        logger.error(f"Ошибка при отправке отчёта завстоловой: {e}")
    
    # Если есть должники - отправляем директору
    if missing_classes:
        director_report_lines = [
            f"⚠️ <b>Классы без отчёта по столовой</b>",
            f"Дата: {today.strftime('%d.%m.%Y')}",
            "",
            "Следующие классы не сдали отчёт:",
        ]
        
        for cls in missing_classes:
            director_report_lines.append(f"  • {cls}")
        
        director_report_lines.append("")
        director_report_lines.append("Пожалуйста, свяжитесь с классными руководителями.")
        
        director_text = "\n".join(director_report_lines)
        
        try:
            directors = await get_staff_by_role("director")
            if directors and directors[0].get("telegram_id"):
                await send_telegram_message(directors[0]["telegram_id"], director_text)
                logger.info(f"Список должников отправлен директору: {directors[0]['fio']}")
            else:
                logger.warning("Не найден директор с telegram_id")
        except Exception as e:
            logger.error(f"Ошибка при отправке списка должников: {e}")
    
    logger.info("Ежедневный отчёт по столовой завершён")


def start_scheduler() -> None:
    """Запустить планировщик."""
    # Запуск каждый день в 09:00
    scheduler.add_job(
        daily_canteen_report,
        trigger=CronTrigger(hour=9, minute=0),
        id="daily_canteen_report",
        name="Ежедневный отчёт по столовой",
        replace_existing=True,
    )
    
    scheduler.start()
    logger.info("Планировщик запущен. Задача daily_canteen_report запланирована на 09:00 ежедневно.")


if __name__ == "__main__":
    # Для тестирования можно запустить напрямую
    import sys
    
    async def test():
        await daily_canteen_report()
    
    if "--test" in sys.argv:
        asyncio.run(test())
    else:
        start_scheduler()
        # Держим процесс alive
        import time
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            scheduler.shutdown()
