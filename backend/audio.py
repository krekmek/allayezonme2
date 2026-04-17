"""Транскрибация голосовых сообщений через Groq Whisper (OpenAI-совместимый API).

Groq предоставляет бесплатный хостинг whisper-large-v3 с тем же SDK, что и OpenAI.
Если потребуется перейти на OpenAI Whisper — достаточно убрать base_url и поменять ключ.
"""
from __future__ import annotations

import io
import logging

from openai import AsyncOpenAI

from config import settings

logger = logging.getLogger(__name__)

_client = AsyncOpenAI(
    api_key=settings.GROQ_API_KEY,
    base_url="https://api.groq.com/openai/v1",
)

_WHISPER_MODEL = "whisper-large-v3"


async def transcribe_ogg(data: bytes, language: str = "ru") -> str:
    """Транскрибирует OGG/Opus (формат Telegram voice) в текст.

    Возвращает пустую строку при ошибке — вызывающий код должен это учесть.
    """
    buf = io.BytesIO(data)
    buf.name = "voice.ogg"  # SDK определяет mime-type по имени файла
    try:
        resp = await _client.audio.transcriptions.create(
            model=_WHISPER_MODEL,
            file=buf,
            language=language,
            response_format="text",
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Whisper transcription failed: %s", exc)
        return ""

    # При response_format="text" SDK возвращает строку (а не объект).
    if isinstance(resp, str):
        return resp.strip()
    # На всякий случай, если вернулся объект с .text
    return str(getattr(resp, "text", "") or "").strip()
