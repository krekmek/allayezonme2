"""
Скрипт для подготовки демо-данных.
Очищает базу и загружает тестовые данные: учителей, расписание, историю сообщений.
"""
import asyncio
import random
from datetime import datetime, timedelta
from typing import Any

from db import supabase
from db import (
    create_attendance_report,
    create_incident,
    create_task,
)


TEACHERS = [
    {"fio": "Айгерим Смаилова", "specialization": "Начальные классы", "telegram_id": 1001, "role": "teacher"},
    {"fio": "Бауыржан Ермекова", "specialization": "Математика", "telegram_id": 1002, "role": "teacher"},
    {"fio": "Гульнара Ахметова", "specialization": "Русский язык", "telegram_id": 1003, "role": "teacher"},
    {"fio": "Данияр Кенжебаев", "specialization": "Физика", "telegram_id": 1004, "role": "teacher"},
    {"fio": "Ержан Смаилов", "specialization": "Химия", "telegram_id": 1005, "role": "teacher"},
    {"fio": "Жанар Кенесова", "specialization": "Биология", "telegram_id": 1006, "role": "teacher"},
    {"fio": "Зауреш Маханова", "specialization": "История", "telegram_id": 1007, "role": "teacher"},
    {"fio": "Ильяс Нурмухамбетов", "specialization": "География", "telegram_id": 1008, "role": "teacher"},
    {"fio": "Камшат Тлегенова", "specialization": "Английский язык", "telegram_id": 1009, "role": "teacher"},
    {"fio": "Ляззат Искакова", "specialization": "Казахский язык", "telegram_id": 1010, "role": "teacher"},
    {"fio": "Мадияр Жумагалиев", "specialization": "Информатика", "telegram_id": 1011, "role": "teacher"},
    {"fio": "Нуржан Абдрахманова", "specialization": "Литература", "telegram_id": 1012, "role": "teacher"},
    {"fio": "Орынбасар Смаилов", "specialization": "Физкультура", "telegram_id": 1013, "role": "teacher"},
    {"fio": "Раушан Мусина", "specialization": "Музыка", "telegram_id": 1014, "role": "teacher"},
    {"fio": "Сания Есенова", "specialization": "Изобразительное искусство", "telegram_id": 1015, "role": "teacher"},
    {"fio": "Бекзат Сапаргалиевна", "specialization": "Директор", "telegram_id": 2000, "role": "director"},
    {"fio": "Арман Косанов", "specialization": "Математика", "telegram_id": 1016, "role": "teacher"},
    {"fio": "Батыр Тургумбаев", "specialization": "Математика", "telegram_id": 1017, "role": "teacher"},
    {"fio": "Дина Смаилова", "specialization": "Русский язык", "telegram_id": 1018, "role": "teacher"},
    {"fio": "Елена Петрова", "specialization": "Русский язык", "telegram_id": 1019, "role": "teacher"},
    {"fio": "Жанболат Кенесов", "specialization": "Физика", "telegram_id": 1020, "role": "teacher"},
    {"fio": "Зарема Маханова", "specialization": "История", "telegram_id": 1021, "role": "teacher"},
    {"fio": "Игорь Иванов", "specialization": "Информатика", "telegram_id": 1022, "role": "teacher"},
    {"fio": "Камила Нурмухамбетова", "specialization": "Английский язык", "telegram_id": 1023, "role": "teacher"},
    {"fio": "Лейла Тлегенова", "specialization": "Казахский язык", "telegram_id": 1024, "role": "teacher"},
]

CLASSES = ["1А", "1Б", "2А", "2Б", "3А", "3Б", "4А", "4Б"]
LESSON_NUMBERS = [1, 2, 3, 4, 5, 6, 7]
DAYS_OF_WEEK = [1, 2, 3, 4, 5]  # Пн-Пт


def _run_sync(func):
    """Обёртка для синхронного выполнения асинхронных функций."""
    def wrapper(*args, **kwargs):
        return asyncio.run(func(*args, **kwargs))
    return wrapper


async def clear_database() -> None:
    """Очистить все таблицы базы данных."""
    tables = ["attendance_reports", "incidents", "tasks", "schedules", "teacher_points", "staff"]
    for table in tables:
        try:
            supabase.table(table).delete().neq("id", 0).execute()
            print(f"✓ Очищена таблица: {table}")
        except Exception as e:
            print(f"✗ Ошибка при очистке {table}: {e}")


async def load_teachers() -> list[dict[str, Any]]:
    """Загрузить учителей в базу данных."""
    teachers = []
    for teacher_data in TEACHERS:
        try:
            resp = (
                supabase.table("staff")
                .insert(teacher_data)
                .execute()
            )
            if resp.data:
                teachers.append(resp.data[0])
                print(f"✓ Добавлен: {teacher_data['fio']}")
        except Exception as e:
            print(f"✗ Ошибка при добавлении {teacher_data['fio']}: {e}")
    return teachers


async def create_schedule(teachers: list[dict[str, Any]]) -> None:
    """Создать расписание уроков."""
    teacher_teachers = [t for t in teachers if t["role"] == "teacher"]
    
    for day in DAYS_OF_WEEK:
        for lesson_num in LESSON_NUMBERS:
            for class_name in CLASSES:
                # Случайный учитель для этого урока
                teacher = random.choice(teacher_teachers)
                # Предмет должен соответствовать специализации учителя
                subject = teacher.get("specialization", "Разное")
                
                try:
                    supabase.table("schedules").insert({
                        "class_name": class_name,
                        "lesson_number": lesson_num,
                        "day_of_week": day,
                        "teacher_id": teacher["id"],
                        "subject": subject,
                        "room": f"{random.randint(100, 120)}",
                    }).execute()
                except Exception as e:
                    print(f"✗ Ошибка при создании расписания: {e}")
    
    print("✓ Расписание создано")


async def generate_week_history(teachers: list[dict[str, Any]]) -> None:
    """Сгенерировать историю сообщений за неделю."""
    teacher_teachers = [t for t in teachers if t["role"] == "teacher"]
    director = next((t for t in teachers if t["role"] == "director"), None)
    
    now = datetime.now()
    
    # Генерируем данные за 7 дней
    for day_offset in range(7):
        date = now - timedelta(days=day_offset)
        date_str = date.strftime("%Y-%m-%d")
        
        # 3-5 отчётов по столовой в день
        num_reports = random.randint(3, 5)
        for _ in range(num_reports):
            teacher = random.choice(teacher_teachers)
            class_name = random.choice(CLASSES)
            present = random.randint(15, 25)
            absent = random.randint(0, 3)
            absent_list = []
            for _ in range(absent):
                absent_list.append(f"Ученик{random.randint(1, 30)}")
            
            try:
                # Создаём отчёт с заданным created_at
                report_data = {
                    "class_name": class_name,
                    "present_count": present,
                    "absent_count": absent,
                    "absent_list": absent_list,
                    "portions": present,
                    "raw_text": f"{class_name} - {present} бала, {absent} ауырып калды",
                    "created_by_tg_id": teacher["telegram_id"],
                    "created_at": f"{date_str} {random.randint(8, 9)}:{random.randint(0, 59)}:{random.randint(0, 59)}",
                }
                supabase.table("attendance_reports").insert(report_data).execute()
            except Exception as e:
                print(f"✗ Ошибка при создании отчёта: {e}")
        
        # 1-2 инцидента в день
        if random.random() > 0.5:
            teacher = random.choice(teacher_teachers)
            incident_types = ["Драка", "Пропуск урока", "Повреждение имущества", "Нарушение дисциплины"]
            incident_type = random.choice(incident_types)
            
            try:
                supabase.table("incidents").insert({
                    "description": f"{incident_type} в классе {random.choice(CLASSES)}",
                    "status": "new" if random.random() > 0.5 else "resolved",
                    "created_by_tg_id": teacher["telegram_id"],
                    "location": random.choice(CLASSES),
                    "created_at": f"{date_str} {random.randint(10, 16)}:{random.randint(0, 59)}:{random.randint(0, 59)}",
                }).execute()
            except Exception as e:
                print(f"✗ Ошибка при создании инцидента: {e}")
        
        # 1-2 задачи в день
        if random.random() > 0.3:
            assignee = random.choice(teacher_teachers)
            task_descriptions = [
                "Подготовить отчёт по посещаемости",
                "Проверить тетради учеников",
                "Провести родительское собрание",
                "Подготовить материалы к уроку",
                "Организовать экскурсию",
            ]
            
            try:
                supabase.table("tasks").insert({
                    "description": random.choice(task_descriptions),
                    "assignee": assignee["fio"],
                    "due_date": (date + timedelta(days=random.randint(1, 3))).strftime("%Y-%m-%d"),
                    "status": random.choice(["new", "in_progress", "done"]),
                    "source": "text",
                    "created_by_tg_id": director["telegram_id"] if director else 2000,
                    "created_at": f"{date_str} {random.randint(9, 12)}:{random.randint(0, 59)}:{random.randint(0, 59)}",
                }).execute()
            except Exception as e:
                print(f"✗ Ошибка при создании задачи: {e}")
    
    print("✓ История за неделю сгенерирована")


async def main() -> None:
    """Главная функция для подготовки демо-данных."""
    print("🚀 Начинаю подготовку демо-данных...\n")
    
    # 1. Очистка базы
    print("1️⃣ Очистка базы данных...")
    await clear_database()
    
    # 2. Загрузка учителей
    print("\n2️⃣ Загрузка учителей...")
    teachers = await load_teachers()
    
    # 3. Создание расписания
    print("\n3️⃣ Создание расписания...")
    await create_schedule(teachers)
    
    # 4. Генерация истории сообщений
    print("\n4️⃣ Генерация истории сообщений за неделю...")
    await generate_week_history(teachers)
    
    print("\n✅ Демо-данные успешно загружены!")


if __name__ == "__main__":
    asyncio.run(main())
