"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  UserX,
  X,
  Loader2,
  Phone,
  CheckCircle2,
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

export default function SchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [staff, setStaff] = useState<Record<number, Staff>>({});
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<number | "all">(todayDow());

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
        <h1 className="text-4xl font-bold tracking-tight text-glow flex items-center gap-3">
          <CalendarDays className="h-8 w-8 text-neon" />
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
        <div className="bg-surface border border-neon rounded-xl p-10 text-center text-muted-foreground">
          Нет уроков для выбранного дня.
        </div>
      ) : (
        <div
          className="bg-surface border border-neon rounded-xl overflow-x-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-neon bg-primary/5">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-16">
                  Урок
                </th>
                {classes.map((cls) => (
                  <th
                    key={cls}
                    className="px-4 py-3 text-left font-semibold text-foreground"
                  >
                    {cls}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lessonNumbers.map((lesson) => (
                <tr key={lesson} className="border-b border-neon/30">
                  <td className="px-4 py-3 text-muted-foreground font-medium">
                    {lesson}
                  </td>
                  {classes.map((cls) => {
                    const s = grid[cls]?.[lesson];
                    if (!s) {
                      return (
                        <td
                          key={cls}
                          className="px-4 py-3 text-muted-foreground/40"
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
                      <td key={cls} className="px-4 py-3 align-top relative">
                        <div className="font-medium">{s.subject}</div>
                        {s.room && (
                          <div className="text-xs text-muted-foreground">
                            каб. {s.room}
                          </div>
                        )}
                        {teacher ? (
                          <div className="relative inline-block">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenCell(isOpen ? null : cellKey);
                              }}
                              className={`mt-1 text-xs rounded-md px-2 py-1 transition border ${
                                isOpen
                                  ? "bg-primary/20 border-neon text-primary shadow-neon-sm"
                                  : "bg-primary/5 border-neon/30 hover:border-neon hover:bg-primary/10"
                              }`}
                            >
                              {teacher.fio}
                            </button>
                            {isOpen && (
                              <div
                                className="absolute z-20 mt-1 left-0 rounded-lg border border-neon bg-background shadow-neon p-2 min-w-[180px]"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="text-xs text-muted-foreground mb-2 px-1">
                                  {teacher.fio}
                                  {teacher.specialization && (
                                    <span className="block text-[10px] opacity-70">
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
                                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-red-500/15 border border-red-500/50 text-red-300 px-3 py-1.5 text-xs font-medium transition hover:bg-red-500/25 hover:shadow-[0_0_10px_rgba(239,68,68,0.4)]"
                                >
                                  <UserX className="h-3.5 w-3.5" />
                                  Заболел
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-1 text-xs text-muted-foreground/60">
                            учитель не назначен
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subModal && (
        <SubstitutionModal
          data={subModal}
          onClose={() => setSubModal(null)}
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
          ? "bg-primary/15 border-neon text-primary shadow-neon-sm"
          : "bg-transparent border-neon/30 text-muted-foreground hover:text-foreground hover:border-neon"
      }`}
    >
      {label}
    </button>
  );
}

function SubstitutionModal({
  data,
  onClose,
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
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-neon rounded-xl w-full max-w-lg shadow-neon"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-neon">
          <div>
            <h3 className="text-lg font-semibold text-glow">Поиск замены</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Заболел: <span className="text-foreground">{data.absent.fio}</span>
              {" · "}
              Класс {data.className}, урок {data.lessonNumber}
              {data.dayOfWeek && ` · ${DAY_NAMES[data.dayOfWeek - 1]}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-foreground"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          {data.loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Ищем свободных педагогов...
            </div>
          ) : data.error ? (
            <div className="py-6 text-center text-red-400">{data.error}</div>
          ) : data.candidates.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              Свободных педагогов с подходящей специализацией не найдено.
            </div>
          ) : (
            <ul className="space-y-2">
              {data.candidates.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-neon/40 bg-background/40 px-4 py-3 hover:border-neon transition"
                >
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      {c.fio}
                    </div>
                    {c.specialization && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {c.specialization}
                      </div>
                    )}
                  </div>
                  {c.telegram_id ? (
                    <span className="inline-flex items-center gap-1 text-xs text-primary">
                      <Phone className="h-3.5 w-3.5" />
                      tg: {c.telegram_id}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      без TG
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-neon flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neon/40 px-4 py-1.5 text-sm hover:bg-primary/10 hover:border-neon"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
