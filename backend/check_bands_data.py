"""Скрипт для проверки band_name в базе данных"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from supabase import create_client
from config import settings

client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)

print("Проверка band_name в таблице schedules...")
resp = client.table("schedules").select("*").execute()
schedules = resp.data or []

print(f"Всего уроков: {len(schedules)}")
band_lessons = [s for s in schedules if s.get("band_name")]
print(f"Уроков с band_name: {len(band_lessons)}")

if band_lessons:
    print("\nПримеры уроков с лентой:")
    for lesson in band_lessons[:5]:
        print(f"  - {lesson['class_name']}: {lesson['subject']} (каб. {lesson['room']}, band_name: {lesson.get('band_name')})")
else:
    print("\n❌ Нет уроков с band_name")
    print("\nПроверяю первые 5 уроков:")
    for lesson in schedules[:5]:
        print(f"  - {lesson['class_name']}: {lesson['subject']} (каб. {lesson['room']}, band_name: {lesson.get('band_name')})")
