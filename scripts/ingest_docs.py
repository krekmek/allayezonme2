"""Загрузка PDF-приказов в Supabase с эмбеддингами Google Gemini для RAG.

Использует существующую инфраструктуру проекта:
  - Модель: gemini-embedding-001 (768 dim, L2-нормализация)
  - Таблица: rag_documents (миграция 007_rag_documents.sql)
  - Логика: backend/rag_service.py (chunk_text + embed_texts + ingest_text)

Использование:
    # Загрузить все PDF из ./docs
    python scripts/ingest_docs.py

    # Конкретные файлы
    python scripts/ingest_docs.py docs/Приказ_130.pdf docs/Приказ_76.pdf

Требования:
    - В .env должны быть: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
    - Выполнена миграция 007_rag_documents.sql
"""
from __future__ import annotations

import argparse
import asyncio
import re
import sys
from pathlib import Path

# Добавляем backend в sys.path
ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

import httpx  # noqa: E402
from pypdf import PdfReader  # noqa: E402

from config import settings  # noqa: E402
from db import supabase  # noqa: E402
from rag_service import chunk_text, _l2_normalize  # noqa: E402

DOCS_DIR = ROOT / "docs"

# Gemini batch embeddings (до 100 текстов за один запрос — решает free-tier rate limit)
EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIM = 768
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
BATCH_SIZE = 100             # Gemini batchEmbedContents limit
SLEEP_BETWEEN_BATCHES = 7.0  # секунд между батчами, чтобы не упираться в RPM


# ---------- PDF → текст ----------
def extract_text_from_pdf(pdf_path: Path) -> str:
    """Извлечь весь текст из PDF."""
    reader = PdfReader(str(pdf_path))
    pages: list[str] = []
    for i, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception as exc:
            print(f"  [warn] Не удалось прочитать страницу {i + 1}: {exc}")
            text = ""
        if text.strip():
            pages.append(text)
    full = "\n\n".join(pages)
    full = re.sub(r"[ \t]+", " ", full)
    full = re.sub(r"\n{3,}", "\n\n", full)
    return full.strip()


def _source_name(pdf_path: Path) -> str:
    """Красивое имя источника: 'Приказ №130' из 'приказ 130.pdf'."""
    stem = pdf_path.stem
    m = re.search(r"(\d+)", stem)
    if m:
        return f"Приказ №{m.group(1)}"
    return stem


# ---------- Gemini batch embeddings с retry ----------
async def embed_batch(
    client: httpx.AsyncClient,
    texts: list[str],
    *,
    max_retries: int = 5,
) -> list[list[float]]:
    """Батч-эмбеддинг через models/{model}:batchEmbedContents. С retry при 429."""
    url = (
        f"{GEMINI_BASE}/models/{EMBEDDING_MODEL}:batchEmbedContents"
        f"?key={settings.GEMINI_API_KEY}"
    )
    body = {
        "requests": [
            {
                "model": f"models/{EMBEDDING_MODEL}",
                "content": {"parts": [{"text": t}]},
                "taskType": "RETRIEVAL_DOCUMENT",
                "outputDimensionality": EMBEDDING_DIM,
            }
            for t in texts
        ]
    }

    delay = 5.0
    for attempt in range(max_retries):
        resp = await client.post(url, json=body)
        if resp.status_code == 200:
            data = resp.json()
            embeddings = data.get("embeddings", [])
            return [_l2_normalize(e.get("values", [])) for e in embeddings]

        if resp.status_code == 429:
            # Извлекаем retryDelay если есть
            try:
                err = resp.json().get("error", {})
                for detail in err.get("details", []):
                    if detail.get("@type", "").endswith("RetryInfo"):
                        rd = detail.get("retryDelay", "")
                        m = re.match(r"(\d+(?:\.\d+)?)", rd)
                        if m:
                            delay = max(delay, float(m.group(1)) + 1.0)
            except Exception:
                pass
            print(f"       [429] rate limit, жду {delay:.0f}s (попытка {attempt + 1}/{max_retries})...")
            await asyncio.sleep(delay)
            delay = min(delay * 1.5, 60.0)
            continue

        raise RuntimeError(f"Gemini error {resp.status_code}: {resp.text[:500]}")

    raise RuntimeError(f"Gemini: превышено число повторных попыток ({max_retries})")


# ---------- Основной пайплайн ----------
async def ingest_pdf(pdf_path: Path) -> int:
    """Обработать один PDF: чанкинг + Gemini batch embeddings + вставка в rag_documents."""
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF не найден: {pdf_path}")

    source = _source_name(pdf_path)
    print(f"\n=== {pdf_path.name} → {source} ===")

    # 1. PDF → текст
    print("  [1/4] Извлекаю текст из PDF...")
    text = extract_text_from_pdf(pdf_path)
    if not text:
        print(f"  [!] Пустой текст в {pdf_path.name}. Пропускаю.")
        return 0
    print(f"       Получено символов: {len(text)}")

    # 2. Чанкинг
    print("  [2/4] Разбиваю на чанки...")
    chunks = chunk_text(text)
    total = len(chunks)
    print(f"       Получено чанков: {total}")

    # 3. Удаляем старые чанки того же source (чтобы избежать дублей)
    print(f"  [3/4] Удаляю старые чанки для {source!r}...")
    await asyncio.to_thread(
        lambda: supabase.table("rag_documents").delete().eq("source", source).execute()
    )

    # 4. Batch embeddings + вставка
    print(f"  [4/4] Эмбеддинги Gemini (батчами по {BATCH_SIZE}) + вставка...")
    inserted = 0
    async with httpx.AsyncClient(timeout=120) as client:
        for start in range(0, total, BATCH_SIZE):
            batch = chunks[start : start + BATCH_SIZE]
            vectors = await embed_batch(client, batch)

            rows = [
                {
                    "source": source,
                    "chunk_index": start + offset,
                    "content": content,
                    "embedding": vec,
                }
                for offset, (content, vec) in enumerate(zip(batch, vectors))
            ]

            def _insert(rs=rows):
                # вставка маленькими подбатчами чтобы не упираться в размер payload
                for i in range(0, len(rs), 50):
                    supabase.table("rag_documents").insert(rs[i : i + 50]).execute()

            await asyncio.to_thread(_insert)
            inserted += len(rows)
            print(f"       Загружено: {inserted}/{total}")

            # Пауза между батчами, чтобы не превышать RPM free-tier
            if start + BATCH_SIZE < total:
                await asyncio.sleep(SLEEP_BETWEEN_BATCHES)

    print(f"  ✓ Готово: {inserted} чанков в rag_documents")
    return inserted


async def amain() -> int:
    parser = argparse.ArgumentParser(
        description="Загрузка PDF-приказов в Supabase (Gemini embeddings → rag_documents)"
    )
    parser.add_argument(
        "files",
        nargs="*",
        help="Пути к PDF. Если не указаны — все *.pdf из ./docs",
    )
    args = parser.parse_args()

    if args.files:
        paths = [Path(f) for f in args.files]
    else:
        if not DOCS_DIR.exists():
            print(f"[!] Папка {DOCS_DIR} не существует.")
            return 1
        paths = sorted(DOCS_DIR.glob("*.pdf"))
        if not paths:
            print(f"[!] В {DOCS_DIR} нет PDF-файлов.")
            return 1

    print(f"Найдено файлов: {len(paths)}")
    for p in paths:
        print(f"  - {p}")

    total = 0
    for pdf_path in paths:
        try:
            total += await ingest_pdf(pdf_path)
        except Exception as exc:
            print(f"[!] Ошибка при обработке {pdf_path}: {exc}")

    print(f"\n✓ Всего загружено чанков: {total}")
    return 0


def main() -> int:
    return asyncio.run(amain())


if __name__ == "__main__":
    sys.exit(main())
