"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  UserX,
  X,
  Loader2,
  Phone,
  CheckCircle2,
  BookOpen,
  Clock,
  MapPin,
  Users,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { findSubstitution, type Staff } from "@/lib/substitution";

type Schedule = {
  id: number;
  class_name: string;
  lesson_number: number;
  teacher_id: number | null;
  room: string | null;
  subject: string;
  day_of_week: number | null;
};

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function todayDow(): number {
  // JS: 0=воскр. Переводим в 1..7 (Пн=1).
  const js = new Date().getDay();
  return js === 0 ? 7 : js;
}

function getCurrentLessonNumber(): number {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const time = hours * 60 + minutes;
  
  // Типичное расписание уроков (можно настроить)
  const lessonTimes = [
    { start: 8 * 60 + 0, end: 8 * 60 + 45, lesson: 1 },
    { start: 8 * 60 + 55, end: 9 * 60 + 40, lesson: 2 },
    { start: 9 * 60 + 50, end: 10 * 60 + 35, lesson: 3 },
    { start: 10 * 60 + 45, end: 11 * 60 + 30, lesson: 4 },
    { start: 11 * 60 + 40, end: 12 * 60 + 25, lesson: 5 },
    { start: 12 * 60 + 35, end: 13 * 60 + 20, lesson: 6 },
    { start: 13 * 60 + 30, end: 14 * 60 + 15, lesson: 7 },
  ];
  
  for (const lt of lessonTimes) {
    if (time >= lt.start && time <= lt.end) {
      return lt.lesson;
    }
  }
  return 0;
}

export default function SchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [staff, setStaff] = useState<Record<number, Staff>>({});
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<number | "all">(todayDow());
  const [currentLesson, setCurrentLesson] = useState<number>(getCurrentLessonNumber());

  // Открытая карточка учителя (показ кнопки «Заболел»)
  const [openCell, setOpenCell] = useState<string | null>(null);

  // Модалка с заменами
  const [subModal, setSubModal] = useState<null | {
    absent: Staff;
    lessonNumber: number;
    className: string;
    dayOfWeek: number | null;
    loading: boolean;
    candidates: Staff[];
    error: string | null;
  }>(null);

  async function assignSubstitution(candidateId: number) {
    if (!subModal) return;
    try {
      const res = await fetch("http://localhost:8001/api/request-substitution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          absent_teacher_id: subModal.absent.id,
          candidate_id: candidateId,
          lesson_number: subModal.lessonNumber,
          class_name: subModal.className,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSubModal(null);
        // Можно добавить уведомление об успехе
      } else {
        console.error("Error assigning substitution:", data);
      }
    } catch (e) {
      console.error("Error assigning substitution:", e);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [schedRes, staffRes] = await Promise.all([
        supabase.from("schedules").select("*").order("lesson_number"),
        supabase
          .from("staff")
          .select("id, fio, role, specialization, telegram_id"),
      ]);
      if (schedRes.error) {
        console.error("Error loading schedules:", schedRes.error);
      }
      if (staffRes.error) {
        console.error("Error loading staff:", staffRes.error);
      }
      setSchedules((schedRes.data as Schedule[]) || []);
      const staffMap: Record<number, Staff> = {};
      for (const s of (staffRes.data as Staff[]) || []) staffMap[s.id] = s;
      setStaff(staffMap);
      setLoading(false);
    }
    load();
  }, []);

  // Обновляем текущий урок каждую минуту
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentLesson(getCurrentLessonNumber());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Фильтрация по дню
  const filtered = useMemo(() => {
    if (selectedDay === "all") return schedules;
    return schedules.filter(
      (s) => s.day_of_week === null || s.day_of_week === selectedDay
    );
  }, [schedules, selectedDay]);

  // Уникальные классы и номера уроков
  const classes = useMemo(() => {
    const set = new Set(filtered.map((s) => s.class_name));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [filtered]);

  const lessonNumbers = useMemo(() => {
    const set = new Set(filtered.map((s) => s.lesson_number));
    if (set.size === 0) return [1, 2, 3, 4, 5, 6, 7];
    return Array.from(set).sort((a, b) => a - b);
  }, [filtered]);

  // Быстрый доступ: map[class][lesson] -> Schedule
  const grid = useMemo(() => {
    const g: Record<string, Record<number, Schedule>> = {};
    for (const s of filtered) {
      if (!g[s.class_name]) g[s.class_name] = {};
      g[s.class_name][s.lesson_number] = s;
    }
    return g;
  }, [filtered]);

  async function handleSick(
    absentTeacher: Staff,
    lessonNumber: number,
    className: string,
    dayOfWeek: number | null
  ) {
    setOpenCell(null);
    setSubModal({
      absent: absentTeacher,
      lessonNumber,
      className,
      dayOfWeek,
      loading: true,
      candidates: [],
      error: null,
    });

    try {
      const candidates = await findSubstitution(
        absentTeacher.id,
        lessonNumber,
        dayOfWeek ?? undefined
      );
      setSubModal((prev) =>
        prev ? { ...prev, loading: false, candidates } : prev
      );
    } catch (e: any) {
      setSubModal((prev) =>
        prev
          ? { ...prev, loading: false, error: e?.message || "Ошибка поиска" }
          : prev
      );
    }
  }

  return (
    <div className="space-y-6" onClick={() => setOpenCell(null)}>
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <CalendarDays className="h-8 w-8 text-muted-foreground" />
          Расписание
        </h1>
        <p className="text-muted-foreground">
          Сетка уроков по классам. Клик по фамилии учителя — пометить «Заболел» и
          подобрать замену.
        </p>
      </header>

      {/* Фильтр по дням недели */}
      <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
        <DayChip
          label="Все"
          active={selectedDay === "all"}
          onClick={() => setSelectedDay("all")}
        />
        {DAY_NAMES.map((name, idx) => {
          const dow = idx + 1;
          return (
            <DayChip
              key={dow}
              label={name}
              active={selectedDay === dow}
              onClick={() => setSelectedDay(dow)}
            />
          );
        })}
      </div>

      {loading ? (
        <div className="p-12 text-center text-muted-foreground">
          Загрузка расписания...
        </div>
      ) : classes.length === 0 ? (
        <div className="bg-card border border-border rounded-md p-10 text-center text-muted-foreground">
          Нет уроков для выбранного дня.
        </div>
      ) : (
        <div
          className="bg-card border border-border rounded-md overflow-x-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-border bg-card">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-20">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4" />
                    Урок
                  </div>
                </th>
                {classes.map((cls) => (
                  <th
                    key={cls}
                    className="px-4 py-3 text-left font-semibold text-foreground"
                  >
                    <div className="flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      {cls}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lessonNumbers.map((lesson) => {
                const isCurrentLesson = selectedDay === todayDow() && lesson === currentLesson;
                return (
                  <tr
                    key={lesson}
                    className={`border-b border-border transition ${
                      isCurrentLesson ? "bg-card/50" : "hover:bg-card/30"
                    }`}
                  >
                    <td className={`px-4 py-3 font-medium transition ${
                      isCurrentLesson ? "text-foreground font-bold" : "text-muted-foreground"
                    }`}>
                      <div className="flex items-center gap-1.5">
                        {isCurrentLesson && <span className="w-2 h-2 rounded-full bg-foreground animate-pulse" />}
                        {lesson}
                      </div>
                    </td>
                    {classes.map((cls) => {
                      const s = grid[cls]?.[lesson];
                      if (!s) {
                        return (
                          <td
                            key={cls}
                            className="px-4 py-3 text-muted-foreground/50"
                          >
                            —
                          </td>
                        );
                      }
                      const teacher = s.teacher_id
                        ? staff[s.teacher_id]
                        : undefined;
                      const cellKey = `${cls}-${lesson}-${s.id}`;
                      const isOpen = openCell === cellKey;
                      return (
                        <td
                          key={cls}
                          className={`px-4 py-3 align-top relative transition ${
                            isCurrentLesson ? "bg-card/50" : ""
                          }`}
                        >
                          <div className={`rounded-md p-3 border transition ${
                            isCurrentLesson
                              ? "bg-card border-border shadow-sm"
                              : "bg-card/50 border-border hover:border-border"
                          }`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm text-foreground">
                                  {s.subject}
                                </div>
                                {s.room && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                    <MapPin className="h-3 w-3" />
                                    каб. {s.room}
                                  </div>
                                )}
                              </div>
                              {teacher ? (
                                <div className="relative inline-block">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenCell(isOpen ? null : cellKey);
                                    }}
                                    className={`text-xs rounded-md px-2 py-1 transition border truncate max-w-[120px] ${
                                      isOpen
                                        ? "bg-card border-border text-foreground"
                                        : "bg-card/50 border-border hover:border-border text-muted-foreground hover:text-foreground"
                                    }`}
                                  >
                                    {teacher.fio}
                                  </button>
                                  {isOpen && (
                                    <div
                                      className="absolute z-20 mt-1 right-0 rounded-md border border-border bg-card shadow-lg p-2 min-w-[200px]"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <div className="text-xs text-muted-foreground mb-2 px-1">
                                        <div className="font-medium text-foreground">{teacher.fio}</div>
                                        {teacher.specialization && (
                                          <span className="block text-[10px] opacity-70 mt-0.5">
                                            {teacher.specialization}
                                          </span>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleSick(
                                            teacher,
                                            s.lesson_number,
                                            s.class_name,
                                            s.day_of_week
                                          )
                                        }
                                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-card border-border text-muted-foreground hover:text-foreground px-3 py-1.5 text-xs font-medium transition hover:bg-card/50"
                                      >
                                        <UserX className="h-3.5 w-3.5" />
                                        Заболел
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground italic">
                                  учитель не назначен
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {subModal && (
        <SubstitutionModal
          data={subModal}
          onClose={() => setSubModal(null)}
          onAssign={assignSubstitution}
        />
      )}
    </div>
  );
}

function DayChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm transition border ${
        active
          ? "bg-card border-border text-white"
          : "bg-transparent border-border text-muted-foreground hover:text-white hover:border-border"
      }`}
    >
      {label}
    </button>
  );
}

function SubstitutionModal({
  data,
  onClose,
  onAssign,
}: {
  data: {
    absent: Staff;
    lessonNumber: number;
    className: string;
    dayOfWeek: number | null;
    loading: boolean;
    candidates: Staff[];
    error: string | null;
  };
  onClose: () => void;
  onAssign: (candidateId: number) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-md w-full max-w-lg shadow-lg dark:bg-card dark:border-border dark:shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-card dark:bg-card dark:border-border">
          <div>
            <h3 className="text-lg font-semibold text-foreground dark:text-foreground flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
              Поиск замены
            </h3>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-2">
              <span className="text-foreground dark:text-foreground font-medium">{data.absent.fio}</span>
              {" · "}
              <span className="text-foreground dark:text-foreground">{data.className}</span>, урок {data.lessonNumber}
              {data.dayOfWeek && ` · ${DAY_NAMES[data.dayOfWeek - 1]}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-card dark:hover:bg-card text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-foreground"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          {data.loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-gray-600 dark:text-gray-400">
              <Loader2 className="h-8 w-8 animate-spin text-gray-600 dark:text-gray-400" />
              <span className="text-sm">Ищем свободных педагогов...</span>
            </div>
          ) : data.error ? (
            <div className="py-8 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-50 dark:bg-red-950/30 mb-3">
                <X className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
              <div className="text-red-600 dark:text-red-400 font-medium">{data.error}</div>
            </div>
          ) : data.candidates.length === 0 ? (
            <div className="py-10 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-card border border-border mb-3">
                <Users className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="text-muted-foreground text-sm">
                Свободных педагогов с подходящей специализацией не найдено
              </div>
            </div>
          ) : (
            <ul className="space-y-3">
              {data.candidates.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-col gap-2 rounded-md border border-border bg-card/50 px-4 py-3 hover:border-border hover:shadow-md transition cursor-pointer"
                  onClick={() => onAssign(c.id)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-medium flex items-center gap-2 text-foreground">
                        <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                        {c.fio}
                      </div>
                      {c.specialization && (
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <BookOpen className="h-3 w-3" />
                          {c.specialization}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {c.telegram_id ? (
                        <span className="inline-flex items-center gap-1 text-xs text-foreground bg-card border border-border px-2 py-1 rounded-md">
                          <Phone className="h-3 w-3" />
                          {c.telegram_id}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground bg-card/50 border border-border px-2 py-1 rounded-md">
                          без TG
                        </span>
                      )}
                    </div>
                  </div>
                  {c.warnings && c.warnings.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      {c.warnings.map((warning, idx) => (
                        <div
                          key={idx}
                          className="text-xs text-muted-foreground flex items-start gap-1"
                        >
                          <span>⚠️</span>
                          <span>{warning}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex justify-between items-center bg-card">
          <span className="text-xs text-muted-foreground">
            Нажмите на кандидата для назначения
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-4 py-1.5 text-sm hover:bg-card transition text-foreground"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
