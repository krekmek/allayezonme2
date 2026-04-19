"""Скрипт для генерации расписания с лентой"""
import sys
from pathlib import Path
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))

API_BASE = "http://localhost:8001"

# Данные ленты
bands_data = {
    "bands": [
        {
            "name": "Английский 3-я параллель (уровневые группы)",
            "classes": ["3А", "3Б", "3В"],
            "subject": "английский язык",
            "hours_per_week": 3,
            "teachers": [142, 143, 144, 145],
            "rooms": ["310", "311", "312", "313"]
        }
    ],
    "dry_run": False
}

print("Генерация расписания с лентой...")
print(f"API: {API_BASE}/api/schedule/generate")
print(f"Данные: {bands_data}")

try:
    with httpx.Client(timeout=60) as client:
        response = client.post(
            f"{API_BASE}/api/schedule/generate",
            json=bands_data
        )
        response.raise_for_status()
        result = response.json()
        print(f"\n✅ Расписание сгенерировано!")
        print(f"Статус: {result.get('status')}")
        print(f"Уроков: {len(result.get('lessons', []))}")
        print(f"Время решения: {result.get('solver_wall_time', 0):.2f} сек")
        
        # Показываем уроки с лентой
        lessons = result.get('lessons', [])
        band_lessons = [l for l in lessons if l.get('band_name')]
        print(f"\nУроков с лентой: {len(band_lessons)}")
        
        if band_lessons:
            print("\nПримеры уроков с лентой:")
            for lesson in band_lessons[:5]:
                print(f"  - {lesson['class_name']}: {lesson['subject']} (каб. {lesson['room']}, {lesson['band_name']})")
        
except httpx.HTTPStatusError as e:
    print(f"\n❌ Ошибка API: {e.response.status_code}")
    print(f"Ответ: {e.response.text}")
except Exception as e:
    print(f"\n❌ Ошибка: {e}")
