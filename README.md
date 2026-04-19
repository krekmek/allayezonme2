# Aqbobek AI School Assistant

Интеллектуальная система управления школой с AI-оркестратором для автоматизации рутинных задач, управления расписанием и обработки сообщений в групповых чатах.

## 📋 Обзор проекта

Проект разработан для образовательного комплекса «Aqbobek» и Aqbobek Lyceum в рамках хакатона AIS Hack 3.0 (трек EdTech & AI Management).

Система решает проблему «узкого горлышка» в управлении школой, автоматизируя:
- Сбор отчётов по посещаемости
- Управление инцидентами
- Распределение задач
- Менеджмент расписания и замен
- Генерацию официальных документов

## ✨ Ключевые функции

### 🤖 NLP-Парсер рабочих чатов
- Автоматический анализ сообщений в групповых чатах учителей
- Классификация сообщений (отчёты по столовой, инциденты, замены, задачи)
- Связывание сообщений в контексте (отсутствие → назначение замены)
- Прямой эфир событий на дашборде в реальном времени

### 🎙️ Voice-to-Task
- Распознавание голосовых команд директора
- Автоматическое распределение задач по исполнителям
- Intent Guard для фильтрации некорректных команд
- Push-уведомления в Telegram

### 📅 Smart-расписание
- Генерация расписания через CP-SAT (OR-Tools)
- Управление нагрузкой учителей
- Автоматический поиск кандидатов на замену
- Конфликт-чекинг кабинетов и времени

### 📚 RAG-система
- Векторная база приказов (№76, №110, №130)
- Генерация официальных документов
- Упрощение бюрократического языка

### 📊 Дашборд директора
- Real-time обновления
- Мониторинг инцидентов
- Управление заменами
- Топ учителей по оперативности
- Прямой эфир школы

## 🛠️ Технологический стек

### Frontend
- **Next.js 13/14** (App Router)
- **TypeScript**
- **TailwindCSS**
- **Supabase Client**
- **React**
- **Lucide Icons**

### Backend
- **Python 3.12**
- **FastAPI**
- **Aiogram 3.x** (Telegram бот)
- **Supabase Python Client**
- **APScheduler** (планировщик задач)

### База данных
- **PostgreSQL** (через Supabase)
- **Supabase Realtime**

### AI/LLM
- **Groq API** (Whisper для транскрипции)
- **Groq API** (Llama 3.3-70B-versatile для задач)
- **Groq API** (Llama для Intent Guard)
- **RAG с LangChain** (для приказов)

### Расписание
- **OR-Tools** (CP-SAT solver)

### Контейнеризация
- **Docker**
- **Docker Compose**

## 🚀 Быстрый старт

### Предварительные требования
- Python 3.12+
- Node.js 18+
- Docker (опционально)
- Supabase аккаунт
- Groq API ключ

### Установка

#### 1. Клонирование репозитория
```bash
git clone <repository-url>
cd allayezonme2
```

#### 2. Настройка Backend

```bash
cd backend
py -m pip install -r requirements.txt
```

Создайте файл `.env` в папке `backend`:
```env
TELEGRAM_BOT_TOKEN=your_bot_token
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
GROQ_API_KEY=your_groq_api_key
DATABASE_URL=your_postgres_url
```

#### 3. Настройка Frontend

```bash
cd frontend
npm install
```

Создайте файл `.env.local` в папке `frontend`:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
GROQ_API_KEY=your_groq_api_key
TELEGRAM_BOT_TOKEN=your_bot_token
```

#### 4. Запуск миграций

Выполните SQL-скрипты из папки `backend/migrations` в Supabase Dashboard в порядке нумерации.

#### 5. Запуск приложения

**Backend (API):**
```bash
cd backend
py api.py
```

**Backend (Telegram Bot):**
```bash
cd backend
py bot.py
```

**Frontend:**
```bash
cd frontend
npm run dev
```

#### 6. Docker (опционально)

```bash
docker-compose up
```

## 📁 Структура проекта

```
allayezonme2/
├── backend/
│   ├── api.py              # FastAPI endpoints
│   ├── bot.py              # Telegram bot
│   ├── db.py               # Supabase client
│   ├── config.py           # Configuration
│   ├── nlp_processor.py    # NLP classification
│   ├── scheduler_service.py # Schedule generation
│   ├── rag_service.py      # RAG document generation
│   ├── audio.py            # Audio transcription
│   ├── logic.py            # Business logic
│   ├── migrations/         # Database migrations
│   └── requirements.txt    # Python dependencies
├── frontend/
│   ├── app/                # Next.js App Router
│   ├── components/         # React components
│   ├── lib/                # Utilities
│   └── package.json        # Node dependencies
├── docs/                   # Documentation
├── skills/                 # Project skills documentation
├── supabase/               # Supabase configuration
└── docker-compose.yml      # Docker configuration
```

## 🎯 Использование

### Telegram Bot

**Основные команды:**
- `/start` - Регистрация / приветствие
- `/help` - Список команд
- `/report` - Отправить отчёт по столовой
- `/points` - Очки оперативности
- `/generate` - Сгенерировать приказ (RAG)

**Групповой чат:**
Бот автоматически анализирует сообщения в групповых чатах и классифицирует их:
- `5А - 25 детей, 2 болеют` → Отчёт по столовой
- `В кабинете 12 сломалась парта` → Инцидент
- `Я заболел` → Отсутствие
- `Айгерим, подмени его` → Замена

### Web Dashboard

- **Главная** - Мониторинг, топ учителей, прямой эфир
- **Расписание** - Просмотр и управление расписанием
- **Классы** - Управление классами
- **Задачи** - Kanban доска задач
- **Настройки** - Настройки системы

### Voice Commands

На дашборде нажмите кнопку микрофона и надиктуйте:
```
"Мы делаем хакатон на следующей неделе. Айгерим, подготовь актовый зал. Назкен, закажи воду и бейджи"
```

Система автоматически:
1. Распознает голос
2. Разделит на задачи
3. Определит исполнителей
4. Отправит уведомления

## 📊 База данных

Основные таблицы:
- `staff` - Сотрудники школы
- `schedules` - Расписание уроков
- `tasks` - Задачи
- `incidents` - Инциденты
- `attendance_reports` - Отчёты по посещаемости
- `absences` - Отсутствия
- `substitutions` - Замены
- `teacher_points` - Очки учителей
- `group_events` - События из групповых чатов
- `rag_documents` - Документы для RAG

Подробная документация схемы в `skills/database-schema.md`.

## 🔧 API Endpoints

### Backend (FastAPI)
- `POST /api/process-text` - Обработка текста для задач
- `POST /api/process-voice` - Обработка голоса для задач
- `GET /api/schedule` - Получение расписания
- `POST /api/schedule/generate` - Генерация расписания
- `POST /api/substitution/find` - Поиск замены

### Frontend (Next.js)
- `POST /api/voice/task` - Обработка голосовых задач
- `POST /api/rag/generate-document` - Генерация документов

Подробная документация в `skills/api-endpoints.md`.

## 🤝 Участие

1. Fork проект
2. Создайте ветку (`git checkout -b feature/AmazingFeature`)
3. Commit изменения (`git commit -m 'Add AmazingFeature'`)
4. Push в ветку (`git push origin feature/AmazingFeature`)
5. Откройте Pull Request

## 📝 Лицензия

Этот проект разработан для образовательного комплекса «Aqbobek» в рамках хакатона AIS Hack 3.0.

## 👥 Команда

Разработано для AIS Hack 3.0 (трек EdTech & AI Management)

## 📞 Поддержка

Для вопросов и предложений обращайтесь к команде проекта.

---

**Примечание:** Для полноценной работы требуется настройка Telegram бота через BotFather и получение API ключей от Groq и Supabase.
