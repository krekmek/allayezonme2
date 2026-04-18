from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    TELEGRAM_BOT_TOKEN: str
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    OPENAI_API_KEY: str = ""
    DEEPSEEK_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    DATABASE_URL: str = ""  # postgres connection string (Supabase → Project Settings → Database)

    # --- Dev fallback ---
    # В seed-данных у 25 учителей фейковые telegram_id (1001-2000).
    # Если ID < 100000, отправляем на этот реальный чат.
    # 0 = отключено (будет ошибка "chat not found").
    DEV_FALLBACK_TG_ID: int = 6343039871

    # --- Twilio WhatsApp API (optional) ---
    # Если не заполнены, WhatsApp-уведомления отключены автоматически.
    # Получить в https://console.twilio.com → Account SID и Auth Token
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    # Sandbox по умолчанию: whatsapp:+14155238886
    # В проде заменить на свой одобренный номер
    TWILIO_WHATSAPP_FROM: str = "whatsapp:+14155238886"

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
