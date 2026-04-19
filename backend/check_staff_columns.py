"""Проверка колонок staff таблицы."""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from db import supabase

# Получаем одну запись
resp = supabase.table("staff").select("*").limit(1).execute()

if resp.data:
    print("Колонки в staff:")
    for key in resp.data[0].keys():
        print(f"  - {key}")
else:
    print("Нет данных в staff")
