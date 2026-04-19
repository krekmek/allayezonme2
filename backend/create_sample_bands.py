"""Скрипт для создания демо-данных для лент (bands)"""
import sys
from pathlib import Path

# Добавляем backend в путь
sys.path.insert(0, str(Path(__file__).resolve().parent))

from supabase import create_client
from config import settings

client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)

# Получаем учителей английского языка
print("Получение учителей английского языка...")
teachers_resp = client.table("staff").select("*").eq("specialization", "английский язык").execute()
english_teachers = teachers_resp.data or []

if len(english_teachers) < 4:
    print(f"⚠️ В базе только {len(english_teachers)} учителей английского языка (нужно минимум 4)")
    print("Создадим демо-ленту с доступными учителями")
else:
    print(f"✅ Найдено {len(english_teachers)} учителей английского языка")

# Получаем классы 3-й параллели
print("\nПолучение классов 3-й параллели...")
classes_resp = client.table("classes").select("*").execute()
all_classes = classes_resp.data or []

# Фильтруем классы 3А, 3Б, 3В (если есть)
parallel_classes = [c for c in all_classes if c["name"] in ["3А", "3Б", "3В"]]

if len(parallel_classes) < 3:
    print(f"⚠️ В базе только {len(parallel_classes)} классов 3-й параллели (нужно минимум 3)")
    # Если нет 3-й параллели, используем любые 3 класса
    if len(all_classes) >= 3:
        parallel_classes = all_classes[:3]
        print(f"Используем классы: {[c['name'] for c in parallel_classes]}")
else:
    print(f"✅ Найдены классы: {[c['name'] for c in parallel_classes]}")

# Создаём демо-ленту
if english_teachers and parallel_classes:
    # Берём 4 учителя для 4 групп
    band_teachers = english_teachers[:4]
    
    # Кабинеты для английского
    band_rooms = ["310", "311", "312", "313"]
    
    # Формируем структуру ленты
    band_data = {
        "name": "Английский 3-я параллель (уровневые группы)",
        "classes": [c["name"] for c in parallel_classes],
        "subject": "английский язык",
        "hours_per_week": 3,
        "teachers": [t["id"] for t in band_teachers],
        "rooms": band_rooms
    }
    
    print("\n📋 Демо-лента для генерации расписания:")
    print(f"Название: {band_data['name']}")
    print(f"Классы: {band_data['classes']}")
    print(f"Предмет: {band_data['subject']}")
    print(f"Часов в неделю: {band_data['hours_per_week']}")
    print(f"Учителя: {[t['fio'] for t in band_teachers]}")
    print(f"Кабинеты: {band_data['rooms']}")
    
    print("\n💡 Для использования этой ленты при генерации расписания, отправьте POST запрос на:")
    print("POST /api/schedule/generate")
    print("с телом:")
    import json
    print(json.dumps({"bands": [band_data]}, indent=2, ensure_ascii=False))
    
    print("\n🎯 Лента будет автоматически:")
    print("1. Найти один и тот же временной слот (например, вторник 10:00)")
    print("2. Заблокировать его для всех 4-х учителей и 4-х кабинетов")
    print("3. Заблокировать его для всех учеников параллели")
    print("4. Распределить учеников по 4 группам по уровню английского")
else:
    print("❌ Недостаточно данных для создания демо-ленты")
    print("Пожалуйста, добавьте в базу:")
    print("- Минимум 4 учителей английского языка")
    print("- Минимум 3 класса одной параллели")
