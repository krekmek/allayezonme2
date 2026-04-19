"""Проверка и исправление нагрузки сотрудников в таблице staff."""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from db import supabase

def check_staff_load():
    """Проверяет наличие колонок weekly_load и max_load в таблице staff."""
    print("Проверка колонок в таблице staff...")
    
    # Получаем одну запись для проверки структуры
    resp = supabase.table("staff").select("*").limit(1).execute()
    
    if not resp.data:
        print("❌ Нет данных в таблице staff")
        return
    
    sample = resp.data[0]
    print(f"Пример записи: {sample.keys()}")
    
    has_weekly_load = "weekly_load" in sample
    has_max_load = "max_load" in sample
    
    print(f"weekly_load колонка: {'✅' if has_weekly_load else '❌'}")
    print(f"max_load колонка: {'✅' if has_max_load else '❌'}")
    
    if not (has_weekly_load and has_max_load):
        print("\n⚠️ Колонки не найдены. Примените миграцию 015_staff_schedule.sql")
        return
    
    # Проверяем данные
    print("\nПроверка данных нагрузки...")
    staff_resp = supabase.table("staff").select("id, fio, role, weekly_load, max_load").execute()
    
    if not staff_resp.data:
        print("❌ Нет сотрудников")
        return
    
    print(f"Всего сотрудников: {len(staff_resp.data)}")
    
    # Считаем с нагрузкой
    with_load = [s for s in staff_resp.data if s.get("weekly_load", 0) > 0 or s.get("max_load", 0) > 0]
    print(f"С заполненной нагрузкой: {len(with_load)}")
    
    if with_load:
        print("\nПримеры:")
        for s in with_load[:5]:
            print(f"  - {s['fio']}: {s.get('weekly_load', 0)}ч / {s.get('max_load', 0)}ч")
    else:
        print("⚠️ Нагрузка не заполнена ни у одного сотрудника")
        print("Примечание: нагрузка рассчитывается из таблицы master_schedule")
        
        # Проверяем есть ли master_schedule
        ms_resp = supabase.table("master_schedule").select("*").limit(1).execute()
        has_master_schedule = len(ms_resp.data) > 0
        print(f"Таблица master_schedule существует: {'✅' if has_master_schedule else '❌'}")
        
        if has_master_schedule:
            print(f"Записей в master_schedule: {len(supabase.table('master_schedule').select('*').execute().data)}")

if __name__ == "__main__":
    check_staff_load()
