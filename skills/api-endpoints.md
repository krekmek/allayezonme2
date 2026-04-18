# API Endpoints

## Backend API (FastAPI)

**Базовый URL:** `http://localhost:8001`  
**CORS:** Разрешены все источники (в проде ограничить доменом)

### Управление задачами

#### POST `/api/process-text`
Принимает распознанный текст голосовой команды, применяет Intent Guard и создаёт задачи.

**Request Body:**
```json
{
  "text": "Напишите отчёт по 5А классу к пятнице"
}
```

**Response (200 OK):**
```json
{
  "valid": true,
  "transcript": "Напишите отчёт по 5А классу к пятнице",
  "tasks": [
    {
      "id": 123,
      "description": "Написать отчёт по 5А классу",
      "assignee": null,
      "due_date": "2024-01-19",
      "status": "new",
      "source": "voice",
      "created_by_tg_id": 0,
      "created_at": "2024-01-15T10:00:00Z"
    }
  ],
  "count": 1
}
```

**Response (400 Bad Request - Invalid):**
```json
{
  "valid": false,
  "transcript": "Привет, как дела",
  "tasks": [],
  "count": 0,
  "reason": "not_a_task",
  "error": "Это приветствие, не поручение"
}
```

#### POST `/api/process-voice`
Принимает аудио файл, транскрибирует через Whisper, применяет Intent Guard и создаёт задачи.

**Request:** multipart/form-data с полем `audio`

**Response:** Аналогично `/api/process-text`

#### POST `/api/tasks`
Создаёт задачу и отправляет уведомление исполнителю.

**Request Body:**
```json
{
  "description": "Подготовить отчёт по посещаемости",
  "assignee": "Иван Петрович",
  "due_date": "2024-01-20"
}
```

**Response (200 OK):**
```json
{
  "id": 124,
  "description": "Подготовить отчёт по посещаемости",
  "assignee": "Иван Петрович",
  "due_date": "2024-01-20",
  "status": "new",
  "source": "text",
  "created_by_tg_id": 0,
  "created_at": "2024-01-15T10:05:00Z"
}
```

### Управление сотрудниками

#### GET `/api/staff`
Получает список всех сотрудников школы.

**Response (200 OK):**
```json
[
  {
    "id": 1,
    "fio": "Бекзат Сапаргалиевна",
    "specialization": "Директор",
    "role": "director",
    "telegram_id": 2000,
    "weekly_load": null,
    "max_load": null
  },
  {
    "id": 2,
    "fio": "Айгерим Смаилова",
    "specialization": "Начальные классы",
    "role": "teacher",
    "telegram_id": 1001,
    "weekly_load": 20,
    "max_load": 25
  }
]
```

#### GET `/api/absences`
Получает заявки об отсутствии со статусом pending.

**Response (200 OK):**
```json
[
  {
    "id": 10,
    "teacher_id": 5,
    "reason_text": "Болезнь",
    "status": "pending",
    "created_at": "2024-01-15T08:00:00Z"
  }
]
```

#### POST `/api/absences`
Создаёт заявку об отсутствии учителя.

**Request Body:**
```json
{
  "teacher_id": 5,
  "reason_text": "Болезнь"
}
```

**Response (200 OK):**
```json
{
  "ok": true,
  "absence": {
    "id": 10,
    "teacher_id": 5,
    "reason_text": "Болезнь",
    "status": "pending",
    "created_at": "2024-01-15T08:00:00Z"
  },
  "teacher": {
    "id": 5,
    "fio": "Данияр Кенжебаев"
  }
}
```

#### POST `/api/absences/{absence_id}/cancel`
Отменяет заявку об отсутствии.

**Response (200 OK):**
```json
{
  "ok": true,
  "absence": {
    "id": 10,
    "teacher_id": 5,
    "status": "rejected"
  }
}
```

### Управление заменами

#### POST `/api/request-substitution`
Создаёт запись о замене со статусом 'pending' и отправляет push кандидату.

**Request Body:**
```json
{
  "absent_teacher_id": 5,
  "candidate_id": 6,
  "absence_id": 10,
  "lesson_number": 3,
  "class_name": "5А",
  "subject": "Математика",
  "room": "101",
  "reason": "Болезнь",
  "day_of_week": 2
}
```

**Response (200 OK):**
```json
{
  "ok": true,
  "notified": true,
  "substitution": {
    "id": 20,
    "absent_teacher_id": 5,
    "substitute_teacher_id": 6,
    "status": "pending"
  },
  "message": "Замена создана, уведомление отправлено Айгерим Смаиловой"
}
```

#### GET `/api/substitution/{teacher_id}`
Находит кандидатов на замену для учителя.

**Query Parameters:**
- `lesson_number` (optional): номер урока
- `day_of_week` (optional): день недели

**Response (200 OK):**
```json
{
  "candidates": [
    {
      "teacher": {
        "id": 6,
        "fio": "Айгерим Смаилова",
        "specialization": "Математика"
      },
      "load": 15,
      "max_load": 25,
      "conflicts": []
    }
  ],
  "count": 1
}
```

#### DELETE `/api/substitutions/{substitution_id}`
Удаляет заявку на замену.

**Response (200 OK):**
```json
{
  "ok": true
}
```

### Расписание

#### POST `/api/schedule/generate`
Генерирует школьное расписание с нуля CP-SAT солвером.

**Request Body:**
```json
{
  "class_names": ["1А", "1Б", "2А", "2Б"],
  "curriculum_overrides": {
    "1А": {
      "Математика": 5,
      "Русский язык": 4
    }
  },
  "bands": [
    {
      "name": "Математика 5А-5Б",
      "classes": ["5А", "5Б"],
      "subject": "Математика",
      "hours_per_week": 4,
      "teachers": [2, 3],
      "rooms": ["101", "102"]
    }
  ],
  "days": 5,
  "periods_per_day": 7,
  "time_limit_sec": 30,
  "dry_run": false
}
```

**Response (200 OK):**
```json
{
  "ok": true,
  "stats": {
    "total_lessons": 140,
    "conflicts_resolved": 5,
    "teacher_loads": {
      "2": 20,
      "3": 18
    }
  },
  "solver_status": "OPTIMAL"
}
```

#### POST `/api/schedule/validate`
Валидирует перемещение урока в расписании.

**Request Body:**
```json
{
  "schedule_id": 100,
  "target_day_of_week": 3,
  "target_lesson_number": 4,
  "target_class_name": null,
  "target_room": null
}
```

**Response (200 OK):**
```json
{
  "valid": true,
  "conflicts": []
}
```

**Response (400 Bad Request - Invalid):**
```json
{
  "valid": false,
  "conflicts": [
    {
      "type": "teacher_conflict",
      "message": "Учитель уже занят на этом уроке"
    }
  ]
}
```

### Учебный план

#### GET `/api/curriculum`
Получает учебный план.

**Response (200 OK):**
```json
[
  {
    "id": 1,
    "class_name": "1А",
    "subject": "Математика",
    "hours_per_week": 5
  }
]
```

#### POST `/api/curriculum`
Создаёт запись учебного плана.

**Request Body:**
```json
{
  "class_name": "1А",
  "subject": "Математика",
  "hours_per_week": 5
}
```

#### PUT `/api/curriculum/{item_id}`
Обновляет запись учебного плана.

#### DELETE `/api/curriculum/{item_id}`
Удаляет запись учебного плана.

### Настройки школы

#### GET `/api/school-settings`
Получает настройки школы.

**Response (200 OK):**
```json
[
  {
    "key": "school_name",
    "value": "Школа №1",
    "description": "Название школы"
  }
]
```

#### PUT `/api/school-settings/{setting_key}`
Обновляет настройку школы.

**Request Body:**
```json
{
  "key": "school_name",
  "value": "Школа №1",
  "description": "Название школы"
}
```

### Типы кабинетов

#### GET `/api/room-types`
Получает типы кабинетов.

**Response (200 OK):**
```json
[
  {
    "id": 1,
    "type_code": "CLASSROOM",
    "name": "Классная комната",
    "capacity": 30
  }
]
```

#### POST `/api/room-types`
Создаёт тип кабинета.

**Request Body:**
```json
{
  "type_code": "CLASSROOM",
  "name": "Классная комната",
  "capacity": 30
}
```

#### PUT `/api/room-types/{item_id}`
Обновляет тип кабинета.

#### DELETE `/api/room-types/{item_id}`
Удаляет тип кабинета.

### RAG функции

#### POST `/api/generate-document`
Генерирует официальное распоряжение директора на основе базы знаний (RAG).

**Request Body:**
```json
{
  "request": "Составить приказ о проверке учебников",
  "director_name": "Бекзат Сапаргалиевна",
  "match_count": 6
}
```

**Response (200 OK):**
```json
{
  "document": "# ПРИКАЗ\nот 15.01.2024 № __\n\n## О проверке учебников\n\n**ОСНОВАНИЕ:** п. 3.2 Приказа №130\n\n**ПРИКАЗЫВАЮ:**\n1. Провести проверку учебников во всех классах\n2. Составить отчёт о выявленных дефектах\n3. Контроль за исполнением настоящего приказа оставляю за собой.\n\nДиректор школы _____________ / Бекзат Сапаргалиевна",
  "title": "О проверке учебников",
  "references": [
    {
      "source": "Приказ №130",
      "chunk_index": 2,
      "similarity": 0.895,
      "snippet": "3.2. Проводить регулярную проверку учебников..."
    }
  ],
  "used_sources": ["Приказ №130"]
}
```

#### POST `/api/rag/simplify`
Упрощает сложный текст приказа для учителей.

**Request Body:**
```json
{
  "text": "В соответствии с пунктом 3.2 Приказа №130, необходимо осуществлять систематический мониторинг состояния учебно-методического обеспечения образовательного процесса."
}
```

**Response (200 OK):**
```json
{
  "bullets": [
    "Проверяйте учебники регулярно",
    "Следите за их состоянием",
    "Сообщайте о проблемах"
  ],
  "raw": "• Проверяйте учебники регулярно\n• Следите за их состоянием\n• Сообщайте о проблемах"
}
```

### Telegram сообщения

#### GET `/api/telegram-messages`
Получает последние Telegram-сообщения с NLP-анализом для витрины.

**Response (200 OK):**
```json
[
  {
    "id": 1,
    "telegram_id": 1001,
    "message_text": "5А - 25 бала, 2 ауырып калды",
    "message_type": "text",
    "classification": "attendance_report",
    "extracted_data": {
      "class_name": "5А",
      "present_count": 25,
      "absent_count": 2
    },
    "created_at": "2024-01-15T09:15:00Z"
  }
]
```

## Frontend API Routes (Next.js)

**Базовый URL:** Относительные пути (например, `/api/voice/task`)

### Голосовые задачи

#### POST `/api/voice/task`
Обрабатывает голосовые команды и текстовые задачи.

**Request Body (JSON):**
```json
{
  "text": "Напишите отчёт по 5А классу"
}
```

**Request Body (FormData - Audio):**
```
audio: <file>
```

**Response (200 OK):**
```json
{
  "valid": true,
  "transcript": "Напишите отчёт по 5А классу",
  "tasks": [...],
  "count": 1
}
```

**Response (400 Bad Request):**
```json
{
  "valid": false,
  "transcript": "Привет",
  "tasks": [],
  "reason": "not_a_task",
  "error": "Это приветствие, не поручение"
}
```

### RAG функции

#### POST `/api/rag/simplify`
Упрощает сложный текст приказа.

**Request Body:**
```json
{
  "text": "Сложный юридический текст"
}
```

**Response (200 OK):**
```json
{
  "bullets": [
    "Первый пункт упрощён",
    "Второй пункт упрощён",
    "Третий пункт упрощён"
  ]
}
```

#### POST `/api/rag/generate-document`
Генерирует официальное распоряжение на базе знаний.

**Request Body:**
```json
{
  "request": "Составить приказ",
  "director_name": "Бекзат Сапаргалиевна",
  "match_count": 6
}
```

**Response (200 OK):**
```json
{
  "document": "# ПРИКАЗ\n...",
  "title": "Заголовок",
  "references": [...],
  "used_sources": [...]
}
```

## Коды ошибок

### Общие ошибки

**400 Bad Request**
- Неверные данные запроса
- Отсутствуют обязательные поля
- Intent Guard отклонил задачу

**401 Unauthorized**
- Отсутствует авторизация
- Неверный токен

**403 Forbidden**
- Недостаточно прав доступа
- Доступ запрещён

**404 Not Found**
- Ресурс не найден
- Неверный ID

**500 Internal Server Error**
- Ошибка сервера
- Ошибка базы данных
- Ошибка внешнего API (Groq, Gemini)

### Специфические ошибки

**GROQ_API_KEY не задан**
- Отсутствует переменная окружения GROQ_API_KEY
- Нужно настроить в .env файле

**Ошибка транскрибации**
- Не удалось распознать голос
- Проблема с аудио файлом

**Ошибка Intent Guard**
- ИИ не распознал задачу
- Нужна конкретика в поручении

**Ошибка Supabase**
- Проблема с подключением к базе данных
- Неверные учётные данные

## Rate Limiting

На данный момент rate limiting не реализован. Рекомендуется добавить для продакшена:

- Ограничение запросов на IP
- Ограничение запросов на пользователя
- Ограничение запросов на endpoint

## Аутентификация

На данный момент аутентификация не реализована. Рекомендуется добавить:

- JWT токены
- OAuth2 (Telegram, Google)
- Role-based access control

## Логирование

Все API запросы логируются в консоль. Рекомендуется добавить:

- Структурированное логирование
- Логирование в файл
- Логирование ошибок в отдельный файл
- Метрики и мониторинг
