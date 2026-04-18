"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Users, User, Clock, MapPin, CheckCircle2, AlertCircle, BookOpen, Info } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Lesson = {
  id: number;
  lesson_number: number;
  subject: string;
  room: string | null;
  teacher_fio: string;
  teacher_specialization: string | null;
  day_of_week: number;
};

type AttendanceReport = {
  id: number;
  class_name: string;
  present_count: number;
  absent_count: number;
  portions: number;
  created_at: string;
};

type HomeroomTeacher = {
  id: number;
  fio: string;
  specialization: string | null;
  telegram_id: number | null;
};

const DAY_NAMES = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const LESSON_TIMES = [
  "08:00 - 08:45",
  "08:55 - 09:40",
  "09:50 - 10:35",
  "10:45 - 11:30",
  "11:40 - 12:25",
  "12:35 - 13:20",
  "13:30 - 14:15",
];

export default function ClassPage({ params }: { params: { className: string } }) {
  const className = decodeURIComponent(params.className);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [attendance, setAttendance] = useState<AttendanceReport | null>(null);
  const [homeroomTeacher, setHomeroomTeacher] = useState<HomeroomTeacher | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(new Date().getDay() === 0 ? 1 : new Date().getDay());

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      
      // Загрузка расписания класса для выбранного дня
      const { data: lessonsData } = await supabase
        .from("schedules")
        .select("*, staff!inner(*)")
        .eq("class_name", className)
        .eq("day_of_week", selectedDay)
        .order("lesson_number");

      if (lessonsData) {
        setLessons(lessonsData.map((l: any) => ({
          id: l.id,
          lesson_number: l.lesson_number,
          subject: l.subject,
          room: l.room,
          teacher_fio: l.staff?.fio || "—",
          teacher_specialization: l.staff?.specialization,
          day_of_week: l.day_of_week,
        })));
      }

      // Загрузка последнего отчёта по посещаемости
      const { data: attendanceData } = await supabase
        .from("attendance_reports")
        .select("*")
        .eq("class_name", className)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      setAttendance(attendanceData);

      // Загрузка классного руководителя (заглушка - нужно добавить поле в staff)
      const { data: teacherData } = await supabase
        .from("staff")
        .select("*")
        .eq("role", "teacher")
        .limit(1)
        .maybeSingle();

      setHomeroomTeacher(teacherData);

      setLoading(false);
    }
    loadData();
  }, [className, selectedDay]);

  const filteredLessons = lessons.filter(l => l.day_of_week === selectedDay);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-foreground">Класс {className}</h1>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Class Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {homeroomTeacher && (
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <User className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-foreground">Классный руководитель</h3>
              </div>
              <p className="text-lg font-medium">{homeroomTeacher.fio}</p>
              {homeroomTeacher.specialization && (
                <p className="text-sm text-muted-foreground">{homeroomTeacher.specialization}</p>
              )}
            </div>
          )}

          {attendance && (
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-5 w-5 text-foreground" />
                <h3 className="font-semibold text-foreground">Посещаемость</h3>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Присутствует:</span>
                  <span className="font-medium text-foreground">{attendance.present_count}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Отсутствует:</span>
                  <span className="font-medium text-foreground">{attendance.absent_count}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Порций:</span>
                  <span className="font-medium text-foreground">{attendance.portions}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Обновлено: {new Date(attendance.created_at).toLocaleString("ru-RU")}
                </p>
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              <h3 className="font-semibold text-foreground">Статистика</h3>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Уроков сегодня:</span>
                <span className="font-medium">{filteredLessons.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Загрузка:</span>
                <span className="font-medium">{Math.round((filteredLessons.length / 7) * 100)}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Day Selector */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {DAY_NAMES.map((day, idx) => (
            idx > 0 && (
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
            )
          ))}
        </div>

        {/* Schedule */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-background/50">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Расписание на {DAY_NAMES[selectedDay]}
            </h2>
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
            <div className="divide-y divide-border">
              {filteredLessons.map((lesson) => (
                <div key={lesson.id} className="px-4 py-4 hover:bg-background/50 transition">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-16 text-center">
                      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-1">
                        <span className="text-lg font-bold text-primary">{lesson.lesson_number}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{LESSON_TIMES[lesson.lesson_number - 1] || ""}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground text-base mb-1">{lesson.subject}</p>
                      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <User className="h-3.5 w-3.5" />
                          <span>{lesson.teacher_fio}</span>
                        </div>
                        {lesson.teacher_specialization && (
                          <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                            {lesson.teacher_specialization}
                          </span>
                        )}
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          <span>каб. {lesson.room || "—"}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Weekly Summary */}
        {!loading && (
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Info className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-foreground">Итоги недели</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center">
              {DAY_NAMES.slice(1).map((day, idx) => {
                const dayIdx = idx + 1;
                const dayLessons = lessons.filter(l => l.day_of_week === dayIdx);
                return (
                  <div
                    key={dayIdx}
                    className={`p-3 rounded-lg ${
                      selectedDay === dayIdx
                        ? "bg-primary text-primary-foreground"
                        : "bg-background/50"
                    }`}
                  >
                    <p className="text-xs font-medium mb-1">{day}</p>
                    <p className="text-lg font-bold">{dayLessons.length}</p>
                    <p className="text-xs opacity-70">уроков</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
