"""Скрипт для заполнения teacher_points демо-данными"""
import sys
from pathlib import Path

# Добавляем backend в путь
sys.path.insert(0, str(Path(__file__).resolve().parent))

from supabase import create_client
from config import settings

client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)

# Получаем список учителей из базы данных
print("Получение списка учителей...")
try:
    result = client.table("staff").select("id, fio, role").eq("role", "teacher").execute()
    teachers = result.data
    print(f"Найдено {len(teachers)} учителей")
except Exception as e:
    print(f"Ошибка при получении учителей: {e}")
    teachers = []

if not teachers:
    print("Нет учителей в базе данных. Сначала заполните таблицу staff.")
    sys.exit(1)

# Создаём демо-данные для топ-5 учителей
demo_data = []
for i, teacher in enumerate(teachers[:5]):
    points = 25 - i * 3  # 25, 22, 19, 16, 13
    reports = points - 7  # 18, 15, 12, 9, 6
    demo_data.append({
        "staff_id": teacher["id"],
        "points": points,
        "reports_before_09_count": reports
    })
    print(f"  {teacher['fio']} (ID: {teacher['id']})")

print("\nЗагрузка демо-данных в teacher_points...")
for data in demo_data:
    try:
        result = client.table("teacher_points").upsert(data, on_conflict="staff_id").execute()
        print(f"✅ staff_id={data['staff_id']}: points={data['points']}")
    except Exception as e:
        print(f"❌ staff_id={data['staff_id']}: {e}")

print("\nГотово! Топ учителей по оперативности заполнен.")
