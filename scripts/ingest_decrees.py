"""Загрузка текстовых приказов в Supabase с эмбеддингами Gemini для RAG.

Использует таблицу rag_documents (миграция 007_rag_documents.sql)
Модель: gemini-embedding-001 (768 dim)

Использование:
    python scripts/ingest_decrees.py
"""
from __future__ import annotations

import asyncio
import httpx
import re
import sys
from pathlib import Path

# Добавляем backend в sys.path
ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from config import settings
from db import supabase
from rag_service import chunk_text, _l2_normalize

DECREES_DIR = BACKEND / "decrees"
EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIM = 768
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"


def source_name(txt_path: Path) -> str:
    """Имя источника из файла: 'Приказ_76.txt' -> 'Приказ №76'."""
    stem = txt_path.stem
    m = re.search(r"(\d+)", stem)
    if m:
        return f"Приказ №{m.group(1)}"
    return stem


async def embed_text(text: str) -> list[float]:
    """Получить эмбеддинг для одного текста через Gemini."""
    url = (
        f"{GEMINI_BASE}/models/{EMBEDDING_MODEL}:embedContent"
        f"?key={settings.GEMINI_API_KEY}"
    )
    body = {
        "model": f"models/{EMBEDDING_MODEL}",
        "content": {"parts": [{"text": text}]},
        "taskType": "RETRIEVAL_DOCUMENT",
        "outputDimensionality": EMBEDDING_DIM,
    }
    
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(url, json=body)
        if resp.status_code == 200:
            data = resp.json()
            embedding = data.get("embedding", {}).get("values", [])
            return _l2_normalize(embedding)
        raise RuntimeError(f"Gemini error {resp.status_code}: {resp.text[:500]}")


async def ingest_decree(txt_path: Path) -> int:
    """Обработать один приказ: чтение + чанкинг + эмбеддинги + вставка."""
    if not txt_path.exists():
        raise FileNotFoundError(f"Файл не найден: {txt_path}")
    
    source = source_name(txt_path)
    
    print(f"\n=== {txt_path.name} → {source} ===")
    
    # 1. Чтение текста
    print("  [1/4] Читаю текст...")
    text = txt_path.read_text(encoding="utf-8")
    if not text.strip():
        print(f"  [!] Пустой текст в {txt_path.name}. Пропускаю.")
        return 0
    print(f"       Символов: {len(text)}")
    
    # 2. Чанкинг
    print("  [2/4] Разбиваю на чанки...")
    chunks = chunk_text(text)
    total = len(chunks)
    print(f"       Чанков: {total}")
    
    # 3. Удаляем старые чанки
    print(f"  [3/4] Удаляю старые чанки для {source!r}...")
    await asyncio.to_thread(
        lambda: supabase.table("rag_documents").delete().eq("source", source).execute()
    )
    
    # 4. Эмбеддинги + вставка
    print(f"  [4/4] Эмбеддинги Gemini + вставка...")
    inserted = 0
    
    for idx, chunk in enumerate(chunks):
        try:
            embedding = await embed_text(chunk)
            
            row = {
                "source": source,
                "chunk_index": idx,
                "content": chunk,
                "embedding": embedding,
            }
            
            await asyncio.to_thread(
                lambda: supabase.table("rag_documents").insert(row).execute()
            )
            inserted += 1
            print(f"       Загружено: {inserted}/{total}")
            
            # Небольшая пауза
            await asyncio.sleep(0.5)
                
        except Exception as exc:
            print(f"  [!] Ошибка на чанке {idx}: {exc}")
            continue
    
    print(f"  ✓ Готово: {inserted} чанков в rag_documents")
    return inserted


async def amain() -> int:
    if not DECREES_DIR.exists():
        print(f"[!] Папка {DECREES_DIR} не существует.")
        return 1
    
    txt_files = sorted(DECREES_DIR.glob("*.txt"))
    if not txt_files:
        print(f"[!] В {DECREES_DIR} нет .txt файлов.")
        return 1
    
    print(f"Найдено файлов: {len(txt_files)}")
    for f in txt_files:
        print(f"  - {f}")
    
    total = 0
    for txt_path in txt_files:
        try:
            total += await ingest_decree(txt_path)
        except Exception as exc:
            print(f"[!] Ошибка при обработке {txt_path}: {exc}")
    
    print(f"\n✓ Всего загружено чанков: {total}")
    return 0


def main() -> int:
    return asyncio.run(amain())


if __name__ == "__main__":
    sys.exit(main())
