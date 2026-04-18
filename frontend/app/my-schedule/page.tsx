"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Clock, MapPin, User, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Lesson = {
  id: number;
  class_name: string;
  lesson_number: number;
  subject: string;
  room: string | null;
  day_of_week: number;
};

type Staff = {
  id: number;
  fio: string;
  specialization: string | null;
};

const DAY_NAMES = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export default function MySchedulePage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(new Date().getDay());
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);

  useEffect(() => {
    async function loadData() {
      // Загрузка текущего пользователя (заглушка - нужно добавить авторизацию)
      const { data: staffData } = await supabase
        .from("staff")
        .select("*")
        .limit(1)
        .single();

      if (staffData) {
        setStaff(staffData);

        const { data: lessonsData } = await supabase
          .from("schedules")
          .select("*")
          .eq("teacher_id", staffData.id)
          .eq("day_of_week", selectedDay)
          .order("lesson_number");

        setLessons(lessonsData || []);
      }
      setLoading(false);
    }
    loadData();
  }, [selectedDay]);

  const filteredLessons = lessons.filter(l => l.day_of_week === selectedDay);

  return (
    <div className="min-h-screen bg-background p-4 pb-20">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Моё расписание</h1>
        {staff && (
          <p className="text-muted-foreground">{staff.fio}</p>
        )}
      </header>

      {/* Day Selector */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {DAY_NAMES.map((day, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setSelectedDay(idx)}
            className={`flex-shrink-0 px-4 py-2 rounded-lg font-medium transition ${
              selectedDay === idx
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border text-muted-foreground hover:border-primary/60"
            }`}
          >
            {day}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          Загрузка...
        </div>
      ) : filteredLessons.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          Уроков нет
        </div>
      ) : (
        <div className="space-y-3">
          {filteredLessons.map((lesson) => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              onSelect={() => setSelectedLesson(lesson)}
            />
          ))}
        </div>
      )}

      {/* Substitution Modal */}
      {selectedLesson && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-card rounded-lg w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-semibold">Урок {selectedLesson.lesson_number}</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <span>{selectedLesson.subject}</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span>каб. {selectedLesson.room || "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span>{selectedLesson.class_name}</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setSelectedLesson(null)}
                className="flex-1 px-4 py-3 rounded-lg bg-background border border-border text-foreground font-medium"
              >
                Отмена
              </button>
              <button
                type="button"
                className="flex-1 px-4 py-3 rounded-lg bg-primary text-primary-foreground font-medium"
              >
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LessonCard({ lesson, onSelect }: { lesson: Lesson; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left bg-card border border-border rounded-lg p-4 hover:border-primary/60 transition active:scale-95"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl font-bold text-primary">{lesson.lesson_number}</span>
            <span className="text-sm text-muted-foreground">урок</span>
          </div>
          <p className="font-medium text-foreground mb-1">{lesson.subject}</p>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            <span>каб. {lesson.room || "—"}</span>
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <User className="h-3.5 w-3.5" />
            <span>{lesson.class_name}</span>
          </div>
        </div>
        <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
      </div>
    </button>
  );
}
