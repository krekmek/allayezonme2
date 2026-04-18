"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CalendarDays, BookOpenText, Trophy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { EmergencyAlerts } from "@/components/emergency-alerts";
import { SubstitutionsLive } from "@/components/substitutions-live";
import { NlpLiveFeed } from "@/components/nlp-live-feed";

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

type TopTeacher = {
  id: number;
  staff_id: number;
  points: number;
  reports_before_09_count: number;
  staff: {
    fio: string;
    specialization: string | null;
  };
};

export default function HomePage() {
  const [topTeachers, setTopTeachers] = useState<TopTeacher[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTopTeachers() {
      const { data, error } = await supabase
        .from("teacher_points")
        .select("*, staff(fio, specialization)")
        .order("points", { ascending: false })
        .limit(3);
      
      if (error) {
        console.error("Error loading top teachers:", error);
      } else {
        setTopTeachers(data as TopTeacher[]);
      }
      setLoading(false);
    }
    loadTopTeachers();
  }, []);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-neon">
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
              className="border border-border bg-card rounded-md p-5 transition hover:shadow-neon hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{c.title}</p>
                  <p className="mt-2 text-3xl font-semibold text-neon">
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

      <EmergencyAlerts />

      <SubstitutionsLive />

      <NlpLiveFeed />

      <section className="bg-card border border-border rounded-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="h-5 w-5 text-neon" />
          <h2 className="text-xl font-semibold text-foreground">Топ учителей по оперативности</h2>
        </div>
        {loading ? (
          <p className="text-muted-foreground">Загрузка...</p>
        ) : topTeachers.length === 0 ? (
          <p className="text-muted-foreground">Нет данных</p>
        ) : (
          <div className="space-y-3">
            {topTeachers.map((teacher, index) => (
              <div
                key={teacher.id}
                className="flex items-center justify-between p-4 bg-background/40 rounded-md border border-border"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20 text-primary font-bold">
                    {index + 1}
                  </div>
                  <div>
                    <p className="font-medium">{teacher.staff.fio}</p>
                    <p className="text-xs text-muted-foreground">
                      {teacher.staff.specialization || "Учитель"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-neon">{teacher.points}</p>
                  <p className="text-xs text-muted-foreground">
                    {teacher.reports_before_09_count} отчётов до 09:00
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-card border border-border rounded-md p-6">
        <h2 className="text-xl font-semibold text-foreground mb-4">Добро пожаловать</h2>
        <p className="text-muted-foreground">
          Это каркас админ-панели. Навигация слева: Мониторинг, Инциденты,
          Расписание, База знаний. Страницы подключим следующим шагом.
        </p>
      </section>
    </div>
  );
}
