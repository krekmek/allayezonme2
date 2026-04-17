# Frontend — School Assistant Admin

Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn-compatible setup + Lucide React.

Тёмная тема: глубокий синий `#020617` с фиолетовым неоновым свечением.

## Запуск

```bash
cd frontend
npm install
npm run dev
```

Откроется на http://localhost:3000

## Структура

```
frontend/
├── app/
│   ├── layout.tsx        # корневой layout + Sidebar
│   ├── page.tsx          # страница Мониторинг (/)
│   └── globals.css       # тёмная тема, CSS-переменные shadcn, неон
├── components/
│   ├── sidebar.tsx       # навигация: Мониторинг, Инциденты, Расписание, База знаний
│   └── ui/               # сюда добавляются компоненты shadcn
├── lib/
│   └── utils.ts          # cn() helper
├── components.json       # конфиг shadcn/ui CLI
└── tailwind.config.ts    # цвета, shadow-neon, анимация
```

## Добавление shadcn-компонентов

Конфиг `components.json` уже настроен. Команды типа:

```bash
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add dialog
```

будут добавлять файлы в `components/ui/`.

## Страницы-заглушки

Маршруты `/incidents`, `/schedule`, `/knowledge` ещё не созданы — при клике
будет 404. Создадим их дальше.
