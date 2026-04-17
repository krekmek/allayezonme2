"""RAG-сервис: чанкинг приказов, эмбеддинги и семантический поиск.

Использует:
- OpenAI text-embedding-3-small (1536 dim) для эмбеддингов.
- Supabase (pgvector) для хранения и поиска ближайших чанков.
- Groq (Llama 3.3 70B) для генерации ответа по найденному контексту.

CLI:
    python rag_service.py ingest ./decrees/76.txt "Приказ №76"
    python rag_service.py ingest-all ./decrees
    python rag_service.py ask "Какой регламент для перевода ученика?"
    python rag_service.py reset        # удалить все чанки

Модуль также экспортирует функции embed_texts / search / answer
для использования из других мест (например, из бота).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import Any

import httpx
from openai import AsyncOpenAI

from config import settings
from db import supabase

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ---------- Клиенты ----------

# Groq — для генерации ответа по контексту
_groq = (
    AsyncOpenAI(api_key=settings.GROQ_API_KEY, base_url="https://api.groq.com/openai/v1")
    if settings.GROQ_API_KEY
    else None
)

# Google Gemini gemini-embedding-001 — Matryoshka, можно ужать до 768 dim.
EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIM = 768
LLM_MODEL = "llama-3.3-70b-versatile"

_GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"


def _l2_normalize(vec: list[float]) -> list[float]:
    """L2-нормализация (Matryoshka-усечённые эмбеддинги gemini-embedding-001
    не нормализованы, а pgvector cosine_ops ждёт единичную длину)."""
    s = sum(x * x for x in vec) ** 0.5
    if s == 0:
        return vec
    return [x / s for x in vec]

# ---------- Chunking ----------

def chunk_text(text: str, *, chunk_size: int = 800, overlap: int = 150) -> list[str]:
    """Разбить текст на чанки с перекрытием.

    Стратегия: сначала режем по абзацам/предложениям, затем склеиваем
    в группы <= chunk_size символов. overlap — перекрытие в символах.
    """
    text = re.sub(r"[ \t]+", " ", text).strip()
    if not text:
        return []

    # Сначала дробим по предложениям (русская пунктуация)
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: list[str] = []
    current = ""
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        if len(current) + len(s) + 1 <= chunk_size:
            current = (current + " " + s).strip()
        else:
            if current:
                chunks.append(current)
            # Если предложение длиннее chunk_size — режем жёстко.
            if len(s) > chunk_size:
                for i in range(0, len(s), chunk_size - overlap):
                    chunks.append(s[i : i + chunk_size])
                current = ""
            else:
                current = s
    if current:
        chunks.append(current)

    # Добавляем overlap между соседними чанками
    if overlap > 0 and len(chunks) > 1:
        result: list[str] = [chunks[0]]
        for i in range(1, len(chunks)):
            prev_tail = chunks[i - 1][-overlap:]
            result.append(prev_tail + " " + chunks[i])
        return result

    return chunks


# ---------- Embeddings ----------

async def embed_texts(texts: list[str], *, is_query: bool = False) -> list[list[float]]:
    """Сгенерировать эмбеддинги через Google Gemini text-embedding-004.

    is_query=True для поисковых запросов (taskType=RETRIEVAL_QUERY),
    иначе — для индексируемых документов (RETRIEVAL_DOCUMENT).
    """
    if not texts:
        return []
    if not settings.GEMINI_API_KEY:
        raise RuntimeError(
            "GEMINI_API_KEY не задан. Получи ключ на https://aistudio.google.com/app/apikey "
            "и добавь в .env."
        )
    task_type = "RETRIEVAL_QUERY" if is_query else "RETRIEVAL_DOCUMENT"

    url = f"{_GEMINI_BASE}/models/{EMBEDDING_MODEL}:embedContent?key={settings.GEMINI_API_KEY}"
    all_vecs: list[list[float]] = []
    async with httpx.AsyncClient(timeout=60) as client:
        for t in texts:
            body = {
                "content": {"parts": [{"text": t}]},
                "taskType": task_type,
                "outputDimensionality": EMBEDDING_DIM,
            }
            resp = await client.post(url, json=body)
            if resp.status_code >= 400:
                raise RuntimeError(
                    f"Gemini embeddings error {resp.status_code}: {resp.text}"
                )
            data = resp.json()
            values = data.get("embedding", {}).get("values", [])
            all_vecs.append(_l2_normalize(values))
    return all_vecs


# ---------- Ingest ----------

async def ingest_text(text: str, source: str) -> int:
    """Нарезать, сэмбеддить и сохранить в rag_documents. Возвращает число чанков."""
    chunks = chunk_text(text)
    if not chunks:
        logger.warning("Пустой текст для источника %r", source)
        return 0

    logger.info("Источник %r: %d чанков, генерируем эмбеддинги...", source, len(chunks))
    embeddings = await embed_texts(chunks)

    # Удаляем старые чанки этого же источника, чтобы не было дублей при повторном ingest
    def _delete_old():
        supabase.table("rag_documents").delete().eq("source", source).execute()

    await asyncio.to_thread(_delete_old)

    # Пачкой инсертим
    rows = [
        {
            "source": source,
            "chunk_index": i,
            "content": chunks[i],
            "embedding": embeddings[i],
        }
        for i in range(len(chunks))
    ]

    def _insert_all():
        # Supabase ограничение на размер payload — инсертим по 50 штук
        BATCH = 50
        for i in range(0, len(rows), BATCH):
            supabase.table("rag_documents").insert(rows[i : i + BATCH]).execute()

    await asyncio.to_thread(_insert_all)
    logger.info("Источник %r: сохранено %d чанков.", source, len(rows))
    return len(rows)


async def ingest_file(path: Path, source: str | None = None) -> int:
    """Считать текст из файла и сделать ingest. source по умолчанию = имя файла."""
    text = path.read_text(encoding="utf-8")
    src = source or path.stem
    return await ingest_text(text, src)


async def ingest_dir(dir_path: Path) -> dict[str, int]:
    """Залить все .txt-файлы из папки. Имя файла → source."""
    result: dict[str, int] = {}
    for file in sorted(dir_path.glob("*.txt")):
        # "Приказ №76" из имени 76.txt
        stem = file.stem
        source = f"Приказ №{stem}" if stem.isdigit() else stem
        count = await ingest_file(file, source)
        result[source] = count
    return result


# ---------- Search & answer ----------

async def search(query: str, match_count: int = 5) -> list[dict[str, Any]]:
    """Семантический поиск чанков под запрос."""
    embeddings = await embed_texts([query], is_query=True)
    query_emb = embeddings[0]

    def _rpc():
        resp = supabase.rpc(
            "match_rag_documents",
            {"query_embedding": query_emb, "match_count": match_count},
        ).execute()
        return resp.data or []

    return await asyncio.to_thread(_rpc)


async def answer(question: str, match_count: int = 5) -> dict[str, Any]:
    """Ответить на вопрос, используя найденный контекст."""
    if not _groq:
        raise RuntimeError("GROQ_API_KEY не задан — не могу сгенерировать ответ.")

    hits = await search(question, match_count=match_count)
    if not hits:
        return {
            "answer": "В базе приказов не нашлось подходящих фрагментов. "
            "Убедитесь, что приказы загружены.",
            "sources": [],
        }

    context_blocks = []
    for h in hits:
        context_blocks.append(
            f"[{h['source']} · фрагмент {h['chunk_index']}]\n{h['content']}"
        )
    context = "\n\n---\n\n".join(context_blocks)

    system = (
        "Ты — помощник школьной администрации по приказам и регламентам. "
        "Отвечай СТРОГО на основе предоставленного контекста. "
        "Если в контексте нет ответа — честно скажи, что информация не найдена. "
        "Ответ давай на русском, кратко и по делу. "
        "Указывай, из какого приказа взят факт (например, «согласно Приказу №76»)."
    )
    user = f"Вопрос: {question}\n\nКонтекст:\n{context}"

    resp = await _groq.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.2,
    )
    text = resp.choices[0].message.content or ""
    return {
        "answer": text.strip(),
        "sources": [
            {
                "source": h["source"],
                "chunk_index": h["chunk_index"],
                "similarity": round(float(h["similarity"]), 3),
                "snippet": h["content"][:240],
            }
            for h in hits
        ],
    }


async def reset_all() -> int:
    """Удалить все чанки. Возвращает количество удалённых (0 если неизвестно)."""
    def _run():
        supabase.table("rag_documents").delete().neq("id", 0).execute()

    await asyncio.to_thread(_run)
    logger.info("Все чанки удалены из rag_documents.")
    return 0


# ---------- CLI ----------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="RAG-сервис для приказов школы.")
    sub = p.add_subparsers(dest="cmd", required=True)

    ingest = sub.add_parser("ingest", help="Залить один файл")
    ingest.add_argument("file", type=Path)
    ingest.add_argument("source", nargs="?", help="Название источника (по умолчанию имя файла)")

    ingest_all = sub.add_parser("ingest-all", help="Залить все .txt из папки")
    ingest_all.add_argument("dir", type=Path)

    ask = sub.add_parser("ask", help="Задать вопрос по базе")
    ask.add_argument("question", nargs="+")
    ask.add_argument("-k", "--top-k", type=int, default=5)

    sub.add_parser("reset", help="Удалить все чанки")
    return p


async def _main_async(args: argparse.Namespace) -> int:
    if args.cmd == "ingest":
        count = await ingest_file(args.file, args.source)
        print(f"OK: сохранено {count} чанков.")
        return 0
    if args.cmd == "ingest-all":
        result = await ingest_dir(args.dir)
        print("Готово:")
        for src, n in result.items():
            print(f"  {src}: {n} чанков")
        return 0
    if args.cmd == "ask":
        question = " ".join(args.question)
        res = await answer(question, match_count=args.top_k)
        print("\n=== Ответ ===")
        print(res["answer"])
        print("\n=== Источники ===")
        for s in res["sources"]:
            print(f"  [{s['similarity']:.3f}] {s['source']} · фрагмент {s['chunk_index']}")
            print(f"    {s['snippet']}...")
        return 0
    if args.cmd == "reset":
        await reset_all()
        print("OK: база очищена.")
        return 0
    return 1


def main() -> None:
    args = _build_parser().parse_args()
    sys.exit(asyncio.run(_main_async(args)))


if __name__ == "__main__":
    main()
