# Database Schema

## Обзор

Система использует PostgreSQL (через Supabase) для хранения всех данных. Схема включает таблицы для сотрудников, задач, расписания, посещаемости, замен и других функций школы.

## Основные таблицы

### staff
**Описание:** Сотрудники школы

**Поля:**
- `id` (int, primary key) - Уникальный идентификатор
- `fio` (text) - ФИО сотрудника
- `specialization` (text, nullable) - Специализация (предмет, должность)
- `role` (text) - Роль (director, admin, vice_director, teacher, maintenance, kitchen)
- `telegram_id` (int, nullable) - Telegram ID для уведомлений
- `weekly_load` (int, nullable) - Текущая недельная нагрузка (часов)
- `max_load` (int, nullable) - Максимальная недельная нагрузка (часов)
- `created_at` (timestamptz) - Время создания
- `updated_at` (timestamptz) - Время обновления

**Индексы:**
- `telegram_id` - для быстрого поиска по Telegram ID

### tasks
**Описание:** Задачи для сотрудников

**Поля:**
- `id` (int, primary key) - Уникальный идентификатор
- `description` (text) - Описание задачи
- `assignee` (text, nullable) - ФИО исполнителя
- `due_date` (date, nullable) - Срок выполнения
- `status` (text) - Статус (new, in_progress, done)
- `source` (text) - Источник (voice, text, telegram)
- `created_by_tg_id` (int) - Telegram ID создателя (0 для фронтенда)
- `created_at` (timestamptz) - Время создания
- `updated_at` (timestamptz) - Время обновления

**Индексы:**
- `status` - для фильтрации по статусу
- `due_date` - для фильтрации по сроку
- `created_at` - для сортировки

### schedules
**Описание:** Расписание уроков

**Поля:**
- `id` (int, primary key) - Уникальный идентификатор
- `class_name` (text) - Название класса (например, "5А")
- `lesson_number` (int) - Номер урока (1-7)
- `day_of_week` (int) - День недели (1-5, Пн-Пт)
- `teacher_id` (int, foreign key) - ID учителя (ссылка на staff)
- `subject` (text) - Предмет
- `room` (text, nullable) - Номер кабинета
- `created_at` (timestamptz) - Время создания
- `updated_at` (timestamptz) - Время обновления

**Индексы:**
- `class_name` - для фильтрации по классу
- `teacher_id` - для фильтрации по учителю
- `day_of_week` - для фильтрации по дню
- `(class_name, day_of_week, lesson_number)` - уникальный индекс

### master_schedule
**Описание:** Основное расписание (шаблон)

**Поля:**
- `id` (int, primary key) - Уникальный идентификатор
- `class_name` (text) - Название класса
- `lesson_number` (int) - Номер урока
- `day_of_week` (int) - День недели
- `teacher_id` (int, nullable) - ID учителя
- `subject` (text) - Предмет
- `room` (text, nullable) - Кабинет
- `task_type` (text) - Тип (lesson, break, other)
- `created_at` (timestamptz) - Время создания
- `updated_at` (timestamptz) - Время обновления

### attendance_reports
**Описание:** Отчёты по посещаемости столовой

**Поля:**
- `id` (int, primary key) - Уникальный идентификатор
- `class_name` (text) - Название класса
- `present_count` (int) - Количество присутствующих
- `absent_count` (int) - Количество отсутствующих
- `absent_list` (text[], nullable) - Список отсутствующих (имена)
- `portions` (int) - Количество порций
- `raw_text` (text) - Исходный текст отчёта
- `created_by_tg_id` (int) - Telegram ID создателя
- `created_at` (timestamptz) - Время создания

**Индексы:**
- `class_name` - для фильтрации по классу
- `created_at` - для сортировки и фильтрации по дате

### incidents
**Описание:** Инциденты в школе

**Поля:**
- `id` (int, primary key) - Уникальный идентификатор
- `description` (text) - Описание инцидента
- `status` (text) - Статус (new, in_progress, resolved)
- `location` (text) - Место (класс, кабинет)
- `created_by_tg_id` (int) - Telegram ID создателя
- `created_at` (timestamptz) - Время создания
- `updated_at` (timestamptz) - Время обновления

**Индексы:**
- `status` - для фильтрации по статусу
- `created_at` - для сортировки

### absences
**Описание:** Заявки об отсутствии учителей

**Поля:**
- `id` (int, primary key) - Уникальный идентификатор
- `teacher_id` (int, foreign key) - ID учителя
- `reason_text` (text, nullable) - Причина отсутствия
- `status` (text) - Статус (pending, approved, rejected, cancelled)
- `created_at` (timestamptz) - Время создания
- `updated_at` (timestamptz) - Время обновления

**Индексы:**
- `teacher_id` - для фильтрации по учителю
- `status` - для фильтрации по статусу

### substitutions
**Описание:** Замены учителей

**Поля:**
- `id` (int, primary key) - Уникальный идентификатор
- `absent_teacher_id` (int, foreign key) - ID отсутствующего учителя
- `substitute_teacher_id` (int, foreign key) - ID заменяющего учителя
- `absence_id` (int, nullable, foreign key) - ID заявки об отсутствии
- `lesson_number` (int, nullable) - Номер урока
- `class_name` (text, nullable) - Класс
- `subject` (text, nullable) - Предмет
- `room` (text, nullable) - Кабинет
- `reason` (text, nullable) - Причина замены
- `day_of_week` (int, nullable) - День недели
- `status` (text) - Статус (pending, accepted, rejected, cancelled)
- `created_at` (timestamptz) - Время создания
- `updated_at` (timestamptz) - Время обновления

**Индексы:**
- `absent_teacher_id` - для фильтрации по отсутствующему
- `substitute_teacher_id` - для фильтрации по заменяющему
- `status` - для фильтрации по статусу

### teacher_points
**Описание:** Баллы учителей (за своевременные отчёты)

**Поля:**
- `id` (int, primary key) - Уникальный идентификатор
- `teacher_id` (int, foreign key) - ID учителя
- `points` (int) - Количество баллов
- `reports_before_09_count` (int) - Количество отчётов до 09:00
- `last_report_at` (timestamptz, nullable) - Время последнего отчёта
- `created_at` (timestamptz) - Время создания
- `updated_at` (timestamptz) - Время обновления

**Индексы:**
- `teacher_id` - уникальный индекс

### curriculum
**Описание:** Учебный план

**Поля:**
- `id` (int, primary key) - Уникальный идентификатор
- `class_name` (text) - Название класса
- `subject` (text) - Предмет
- `hours_per_week` (int) - Часов в неделю
- `created_at` (timestamptz) - Время создания
- `updated_at` (timestamptz) - Время обновления

**Индексы:**
- `(class_name, subject)` - уникальный индекс

### room_types
**Описание:** Типы кабинетов

**Поля:**
- `id` (int, primary key) - Уникальный идентификатор
- `type_code` (text) - Код типа (например, "CLASSROOM")
- `name` (text) - Название типа
- `capacity` (int) - Вместимость
- `created_at` (timestamptz) - Время создания
- `updated_at` (timestamptz) - Время обновления

**Индексы:**
- `type_code` - уникальный индекс

### school_settings
**Описание:** Настройки школы

**Поля:**
- `key` (text, primary key) - Ключ настройки
- `value` (text) - Значение
- `description` (text, nullable) - Описание
- `created_at` (timestamptz) - Время создания
- `updated_at` (timestamptz) - Время обновления

### rag_documents
**Описание:** Документы для RAG системы

**Поля:**
- `id` (int, primary key) - Уникальный идентификатор
- `source` (text) - Источник документа (название файла, номер приказа)
- `content` (text) - Содержимое документа
- `chunk_index` (int) - Индекс фрагмента
- `embedding` (vector) - Векторное представление (pgvector)
- `created_at` (timestamptz) - Время создания

**Индексы:**
- `source` - для фильтрации по источнику
- `embedding` - для векторного поиска (pgvector)

### telegram_messages
**Описание:** Сообщения из Telegram (для анализа)

**Поля:**
- `id` (int, primary key) - Уникальный идентификатор
- `telegram_id` (int) - Telegram ID отправителя
- `message_text` (text) - Текст сообщения
- `message_type` (text) - Тип сообщения (text, voice)
- `classification` (text, nullable) - Классификация (attendance_report, task, other)
- `extracted_data` (jsonb, nullable) - Извлечённые данные
- `created_at` (timestamptz) - Время создания

**Индексы:**
- `telegram_id` - для фильтрации по пользователю
- `created_at` - для сортировки

## Связи между таблицами

```
staff (1) ────────< (N) schedules
staff (1) ────────< (N) tasks (как assignee)
staff (1) ────────< (N) absences
staff (1) ────────< (N) substitutions (как absent_teacher)
staff (1) ────────< (N) substitutions (как substitute_teacher)
staff (1) ────────< (1) teacher_points
staff (1) ────────< (N) telegram_messages

absences (1) ────────< (N) substitutions
```

## Миграции

Миграции находятся в папке `backend/migrations/` и именуются по порядку:

- `001_init.sql` - Инициализация базы данных
- `002_tasks.sql` - Таблица задач
- `003_schedules_day.sql` - Расписание по дням
- `004_attendance_reports.sql` - Отчёты по посещаемости
- `005_incidents.sql` - Инциденты
- `006_absences.sql` - Заявки об отсутствии
- `007_substitutions.sql` - Замены
- `008_teacher_points.sql` - Баллы учителей
- `009_rag_documents.sql` - Документы для RAG
- `010_curriculum.sql` - Учебный план
- `011_room_types.sql` - Типы кабинетов
- `012_school_settings.sql` - Настройки школы
- `013_telegram_messages.sql` - Сообщения Telegram
- `014_master_schedule.sql` - Основное расписание
- `015_add_updated_at.sql` - Добавление updated_at
- `016_fix_teacher_points.sql` - Исправление баллов
- `017_add_source_to_tasks.sql` - Добавление source в tasks
- `018_add_created_by_tg_id.sql` - Добавление created_by_tg_id
- `019_add_status_to_absences.sql` - Добавление status в absences
- `020_add_location_to_incidents.sql` - Добавление location в incidents

## Реальные подписки (Realtime)

Supabase Realtime используется для мгновенных уведомлений об изменениях в базе данных.

**Подписываемые таблицы:**
- `attendance_reports` - новые отчёты по столовой
- `tasks` - новые задачи
- `incidents` - новые инциденты
- `substitutions` - изменения в заменах

## Резервное копирование

Supabase предоставляет автоматическое резервное копирование базы данных. Рекомендуется:

- Ежедневные автоматические бэкапы
- Ручные бэкапы перед важными изменениями
- Point-in-time recovery для восстановления на определённый момент

## Оптимизация

### Индексы
- Все поля, по которым идёт фильтрация и сортировка, проиндексированы
- Композитные индексы для часто используемых комбинаций
- Векторные индексы для pgvector

### Запросы
- Используйте SELECT только нужных полей
- Применяйте LIMIT для больших выборок
- Используйте кэширование для частых запросов

### Размеры таблиц
- Регулярно анализируйте размер таблиц
- Архивируйте старые данные (например, отчёты за прошлые годы)
- Очищайте временные данные

## Безопасность

### Row Level Security (RLS)
Supabase поддерживает RLS для ограничения доступа на уровне строк.

### Политики RLS
- `public` доступ для чтения некоторых таблиц
- Ограниченный доступ для записи на основе роли пользователя
- Защита конфиденциальных данных

### Шифрование
- TLS для всех соединений
- Шифрование данных при хранении
- Шифрование бэкапов
