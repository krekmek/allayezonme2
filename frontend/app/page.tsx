import { Activity, AlertTriangle, CalendarDays, BookOpenText } from "lucide-react";

const cards = [
  {
    title: "Активные инциденты",
    value: "3",
    hint: "за последние сутки",
    icon: AlertTriangle,
  },
  {
    title: "Задачи в работе",
    value: "12",
    hint: "распоряжений директора",
    icon: Activity,
  },
  {
    title: "Уроков сегодня",
    value: "48",
    hint: "в 14 кабинетах",
    icon: CalendarDays,
  },
  {
    title: "Статей в базе",
    value: "26",
    hint: "доступны для поиска",
    icon: BookOpenText,
  },
];

export default function HomePage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-glow">
          Мониторинг
        </h1>
        <p className="text-muted-foreground">
          Общее состояние системы в реальном времени.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.title}
              className="bg-surface border border-neon rounded-xl p-5 transition hover:shadow-neon hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{c.title}</p>
                  <p className="mt-2 text-3xl font-semibold text-glow">
                    {c.value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{c.hint}</p>
                </div>
                <div className="rounded-lg bg-primary/10 p-2 text-primary shadow-neon-sm">
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <section className="bg-surface border border-neon rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-4">Добро пожаловать</h2>
        <p className="text-muted-foreground">
          Это каркас админ-панели. Навигация слева: Мониторинг, Инциденты,
          Расписание, База знаний. Страницы подключим следующим шагом.
        </p>
      </section>
    </div>
  );
}
