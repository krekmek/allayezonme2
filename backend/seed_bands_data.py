"""Скрипт для добавления демо-данных для лент (bands)"""
import sys
from pathlib import Path

# Добавляем backend в путь
sys.path.insert(0, str(Path(__file__).resolve().parent))

from supabase import create_client
from config import settings

client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)

print("Добавление демо-данных для лент...")

# 1. Добавляем учителей английского языка
print("\n1. Добавление учителей английского языка...")
english_teachers = [
    {"fio": "Айгерим Смагулова", "role": "teacher", "specialization": "английский язык", "telegram_id": 2001},
    {"fio": "Назкен Ермекова", "role": "teacher", "specialization": "английский язык", "telegram_id": 2002},
    {"fio": "Динара Кенжебаева", "role": "teacher", "specialization": "английский язык", "telegram_id": 2003},
    {"fio": "Алина Смаилова", "role": "teacher", "specialization": "английский язык", "telegram_id": 2004},
]

for teacher in english_teachers:
    try:
        resp = client.table("staff").insert(teacher).execute()
        print(f"  ✅ {teacher['fio']} добавлен")
    except Exception as e:
        # Игнорируем дубликаты
        print(f"  ⚠️ {teacher['fio']} уже существует")

# 2. Добавляем классы 3-й параллели
print("\n2. Добавление классов 3-й параллели...")
parallel_classes = [
    {"name": "3А", "grade": 3},
    {"name": "3Б", "grade": 3},
    {"name": "3В", "grade": 3},
]

for cls in parallel_classes:
    try:
        resp = client.table("classes").insert(cls).execute()
        print(f"  ✅ Класс {cls['name']} добавлен")
    except Exception as e:
        print(f"  ⚠️ Класс {cls['name']} уже существует")

# 3. Получаем ID добавленных учителей
print("\n3. Получение ID учителей...")
teachers_resp = client.table("staff").select("*").eq("specialization", "английский язык").execute()
english_teachers = teachers_resp.data or []

if len(english_teachers) >= 4:
    teacher_ids = [t["id"] for t in english_teachers[:4]]
    print(f"  ✅ Получены ID учителей: {teacher_ids}")
else:
    print(f"  ❌ Недостаточно учителей: {len(english_teachers)}")
    sys.exit(1)

# 4. Формируем демо-ленту
print("\n4. Создание демо-ленты...")
band_data = {
    "name": "Английский 3-я параллель (уровневые группы)",
    "classes": ["3А", "3Б", "3В"],
    "subject": "английский язык",
    "hours_per_week": 3,
    "teachers": teacher_ids,
    "rooms": ["310", "311", "312", "313"]
}

print("\n📋 Демо-лента готова для генерации расписания:")
print(f"Название: {band_data['name']}")
print(f"Классы: {band_data['classes']}")
print(f"Предмет: {band_data['subject']}")
print(f"Часов в неделю: {band_data['hours_per_week']}")
print(f"Учителя ID: {band_data['teachers']}")
print(f"Кабинеты: {band_data['rooms']}")

print("\n💡 Для использования этой ленты при генерации расписания:")
print("POST /api/schedule/generate")
print("Тело:")
import json
print(json.dumps({"bands": [band_data]}, indent=2, ensure_ascii=False))

print("\n✅ Демо-данные добавлены!")
