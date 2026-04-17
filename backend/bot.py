import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import CommandStart
from aiogram.types import Message

from config import settings

logging.basicConfig(level=logging.INFO)

bot = Bot(
    token=settings.TELEGRAM_BOT_TOKEN,
    default=DefaultBotProperties(parse_mode=ParseMode.HTML),
)
dp = Dispatcher()


@dp.message(CommandStart())
async def handle_start(message: Message) -> None:
    await message.answer("Привет! Бот на связи.")


async def main() -> None:
    print("Бот запущен и готов к работе")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
