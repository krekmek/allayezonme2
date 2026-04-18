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
  AlertTriangle,
  Flame,
  GripVertical,
  Wrench,
} from "lucide-react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { supabase } from "@/lib/supabase";
import { findSubstitution, type Staff } from "@/lib/substitution";

type Schedule = {
  id: number;
  class_name: string | null;
  lesson_number: number;
  teacher_id: number | null;
  room: string | null;
  subject: string;
  day_of_week: number | null;
  type?: "lesson" | "task";
  task_id?: number | null;
  title?: string | null;
  description?: string | null;
};

type Conflict = { type: string; message: string };

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

function todayDow(): number {
  const js = new Date().getDay();
  return js === 0 ? 7 : js;
}

function getCurrentLessonNumber(): number {
  const now = new Date();
  const time = now.getHours() * 60 + now.getMinutes();
  const lessonTimes = [
    { start: 8 * 60, end: 8 * 60 + 45, lesson: 1 },
    { start: 8 * 60 + 55, end: 9 * 60 + 40, lesson: 2 },
    { start: 9 * 60 + 50, end: 10 * 60 + 35, lesson: 3 },
    { start: 10 * 60 + 45, end: 11 * 60 + 30, lesson: 4 },
    { start: 11 * 60 + 40, end: 12 * 60 + 25, lesson: 5 },
    { start: 12 * 60 + 35, end: 13 * 60 + 20, lesson: 6 },
    { start: 13 * 60 + 30, end: 14 * 60 + 15, lesson: 7 },
  ];
  for (const lt of lessonTimes) {
    if (time >= lt.start && time <= lt.end) return lt.lesson;
  }
  return 0;
}

// ============================================================
// Heatmap: цвет по нагрузке учителя на день
// level: 0..4 (0 = нет перегрузки, 4 = максимум)
// Правила (по ТЗ):
//   - 5 и более уроков в день → градиент желтый→красный по количеству
//   - если 4+ уроков и есть окна (gaps > 0) → повышаем уровень
// ============================================================
function heatmapLevel(lessonsCount: number, gaps: number): number {
  if (lessonsCount <= 3 && gaps === 0) return 0;
  if (lessonsCount === 4 && gaps === 0) return 0;
  if (lessonsCount === 4 && gaps > 0) return 2;
  if (lessonsCount === 5) return gaps > 0 ? 3 : 2;
  if (lessonsCount === 6) return gaps > 0 ? 4 : 3;
  if (lessonsCount >= 7) return 4;
  return 0;
}

const HEATMAP_CLASSES: Record<number, string> = {
  0: "", // no tint
  1: "bg-amber-500/10 ring-1 ring-amber-500/20",
  2: "bg-amber-500/20 ring-1 ring-amber-500/40",
  3: "bg-orange-500/25 ring-1 ring-orange-500/50",
  4: "bg-red-500/30 ring-2 ring-red-500/70 shadow-[0_0_14px_rgba(239,68,68,0.35)]",
};

function heatmapLabel(level: number): string {
  switch (level) {
    case 0: return "Нагрузка в норме";
    case 1: return "Небольшая нагрузка";
    case 2: return "Повышенная нагрузка";
    case 3: return "Перегрузка — есть окна";
    case 4: return "Критическая перегрузка";
    default: return "";
  }
}

// ============================================================
// Главный компонент
// ============================================================

export default function SchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [staff, setStaff] = useState<Record<number, Staff>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | "all">(todayDow());
  const [currentLesson, setCurrentLesson] = useState<number>(
    getCurrentLessonNumber()
  );
  const [openCell, setOpenCell] = useState<string | null>(null);
  const [subModal, setSubModal] = useState<null | {
    absent: Staff;
    lessonNumber: number;
    className: string;
    dayOfWeek: number | null;
    loading: boolean;
    candidates: Staff[];
    error: string | null;
  }>(null);

  // Drag state
  const [activeId, setActiveId] = useState<number | null>(null);
  const [draggingSchedule, setDraggingSchedule] = useState<Schedule | null>(null);
  const [flashConflict, setFlashConflict] = useState<{
    cellKey: string;
    conflicts: Conflict[];
  } | null>(null);
  const [validating, setValidating] = useState(false);
  const [toast, setToast] = useState<{
    kind: "ok" | "err";
    message: string;
  } | null>(null);

  // Показ тоста (автоисчезает)
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Flash красным — 1.5с
  useEffect(() => {
    if (!flashConflict) return;
    const t = setTimeout(() => setFlashConflict(null), 1800);
    return () => clearTimeout(t);
  }, [flashConflict]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);
      const timeout = setTimeout(() => {
        console.error("Load timeout - data not loaded in 10s");
        setLoadError("Таймаут загрузки данных. Проверьте соединение с Supabase.");
        setLoading(false);
      }, 10000);

      try {
        const [schedRes, staffRes] = await Promise.all([
          supabase.from("schedules").select("*").order("lesson_number"),
          supabase
            .from("staff")
            .select("id, fio, role, specialization, telegram_id, weekly_load, max_load"),
        ]);
        clearTimeout(timeout);
        if (schedRes.error) {
          console.error("schedules error:", schedRes.error);
          setLoadError(`Ошибка загрузки расписания: ${schedRes.error.message}`);
        }
        if (staffRes.error) {
          console.error("staff error:", staffRes.error);
          setLoadError(`Ошибка загрузки сотрудников: ${staffRes.error.message}`);
        }
        setSchedules((schedRes.data as Schedule[]) || []);
        const staffMap: Record<number, Staff> = {};
        for (const s of (staffRes.data as Staff[]) || []) staffMap[s.id] = s;
        setStaff(staffMap);
      } catch (e: any) {
        clearTimeout(timeout);
        console.error("Load error:", e);
        setLoadError(e?.message || "Неизвестная ошибка загрузки");
      } finally {
        clearTimeout(timeout);
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    const i = setInterval(() => setCurrentLesson(getCurrentLessonNumber()), 60000);
    return () => clearInterval(i);
  }, []);

  const filtered = useMemo(() => {
    if (selectedDay === "all") return schedules;
    return schedules.filter(
      (s) => s.day_of_week === null || s.day_of_week === selectedDay
    );
  }, [schedules, selectedDay]);

  const classes = useMemo(() => {
    const set = new Set(filtered.map((s) => s.class_name).filter((c): c is string => c != null));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [filtered]);

  const lessonNumbers = useMemo(() => {
    const set = new Set(filtered.map((s) => s.lesson_number));
    if (set.size === 0) return [1, 2, 3, 4, 5, 6, 7];
    return Array.from(set).sort((a, b) => a - b);
  }, [filtered]);

  const grid = useMemo(() => {
    const g: Record<string, Record<number, Schedule>> = {};
    for (const s of filtered) {
      if (s.class_name) {
        if (!g[s.class_name]) g[s.class_name] = {};
        g[s.class_name][s.lesson_number] = s;
      }
    }
    return g;
  }, [filtered]);

  // ============================================================
  // Heatmap stats: (teacher_id, day) → {lessons, gaps, level}
  // ============================================================
  const teacherDayStats = useMemo(() => {
    const stats: Record<string, { lessons: number; gaps: number; level: number }> = {};
    const byTeacherDay: Record<string, number[]> = {};
    for (const s of schedules) {
      if (!s.teacher_id || !s.day_of_week) continue;
      const key = `${s.teacher_id}-${s.day_of_week}`;
      (byTeacherDay[key] ||= []).push(s.lesson_number);
    }
    for (const [key, lessons] of Object.entries(byTeacherDay)) {
      const sorted = [...new Set(lessons)].sort((a, b) => a - b);
      const span = sorted[sorted.length - 1] - sorted[0] + 1;
      const gaps = span - sorted.length;
      const level = heatmapLevel(sorted.length, gaps);
      stats[key] = { lessons: sorted.length, gaps, level };
    }
    return stats;
  }, [schedules]);

  function getHeatmapFor(teacher_id: number | null, day: number | null) {
    if (!teacher_id || !day) return null;
    return teacherDayStats[`${teacher_id}-${day}`] || null;
  }

  // ============================================================
  // DnD: sensors
  // ============================================================
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  function handleDragStart(e: DragStartEvent) {
    const id = Number(e.active.id);
    setActiveId(id);
    const found = schedules.find((s) => s.id === id) || null;
    setDraggingSchedule(found);
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveId(null);
    const srcId = Number(active.id);
    const source = schedules.find((s) => s.id === srcId);
    if (!source) {
      setDraggingSchedule(null);
      return;
    }

    if (!over) {
      setDraggingSchedule(null);
      return;
    }

    // over.id закодирован как "cls|lesson" — целевая ячейка
    const targetId = String(over.id);
    const [tClass, tLessonStr] = targetId.split("|");
    const tLesson = Number(tLessonStr);
    if (!tClass || !Number.isFinite(tLesson)) {
      setDraggingSchedule(null);
      return;
    }

    // Определяем target_day: если фильтр "all" — оставляем текущий день источника
    const targetDay =
      selectedDay === "all" ? source.day_of_week : Number(selectedDay);
    if (!targetDay) {
      setDraggingSchedule(null);
      return;
    }

    // То же место — ничего не делаем
    if (
      source.class_name === tClass &&
      source.lesson_number === tLesson &&
      source.day_of_week === targetDay
    ) {
      setDraggingSchedule(null);
      return;
    }

    setValidating(true);
    try {
      console.log("Validating move:", {
        schedule_id: source.id,
        target_day_of_week: targetDay,
        target_lesson_number: tLesson,
        target_class_name: tClass,
      });
      const resp = await fetch(`${API_BASE}/api/schedule/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schedule_id: source.id,
          target_day_of_week: targetDay,
          target_lesson_number: tLesson,
          target_class_name: tClass,
        }),
      });
      const data = await resp.json();
      console.log("Validation response:", data);
      if (!resp.ok) throw new Error(data?.error || "Ошибка валидации");

      if (data.ok) {
        // Обновляем в Supabase
        const { error: updErr } = await supabase
          .from("schedules")
          .update({
            class_name: tClass,
            lesson_number: tLesson,
            day_of_week: targetDay,
          })
          .eq("id", source.id);
        if (updErr) throw new Error(updErr.message);

        setSchedules((prev) =>
          prev.map((s) =>
            s.id === source.id
              ? {
                  ...s,
                  class_name: tClass,
                  lesson_number: tLesson,
                  day_of_week: targetDay,
                }
              : s
          )
        );
        setToast({
          kind: "ok",
          message: `Урок перенесён: ${tClass}, ${tLesson}-й урок`,
        });
      } else {
        // Конфликт — мигаем ячейкой и показываем сообщение
        const key = `${tClass}|${tLesson}`;
        setFlashConflict({ cellKey: key, conflicts: data.conflicts || [] });
        setToast({
          kind: "err",
          message:
            data.conflicts?.[0]?.message ||
            "Конфликт при переносе — действие отменено",
        });
      }
    } catch (err: any) {
      setToast({ kind: "err", message: err?.message || "Сетевая ошибка" });
    } finally {
      setValidating(false);
      setDraggingSchedule(null);
    }
  }

  // ============================================================
  // Подбор замены (как было)
  // ============================================================
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
      setSubModal((prev) => (prev ? { ...prev, loading: false, candidates } : prev));
    } catch (e: any) {
      setSubModal((prev) =>
        prev ? { ...prev, loading: false, error: e?.message || "Ошибка поиска" } : prev
      );
    }
  }

  async function assignSubstitution(candidateId: number) {
    if (!subModal) return;
    try {
      const res = await fetch(`${API_BASE}/api/request-substitution`, {
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
      if (data.ok) setSubModal(null);
      else console.error("assign err", data);
    } catch (e) {
      console.error(e);
    }
  }

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="space-y-6" onClick={() => setOpenCell(null)}>
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <CalendarDays className="h-8 w-8 text-muted-foreground" />
          Расписание
        </h1>
        <p className="text-muted-foreground">
          <Flame className="inline h-4 w-4 -mt-0.5 text-orange-500" /> Heatmap
          нагрузки учителей. Перетаскивайте уроки мышкой — система проверит
          конфликты и подсветит красным, если возник конфликт.
        </p>
      </header>

      {/* Легенда heatmap */}
      <div
        className="flex flex-wrap items-center gap-2 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-muted-foreground mr-1">Heatmap:</span>
        {[0, 1, 2, 3, 4].map((lvl) => (
          <span
            key={lvl}
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 border border-border ${HEATMAP_CLASSES[lvl]}`}
          >
            <span className="w-2 h-2 rounded-full bg-current opacity-70" />
            {heatmapLabel(lvl)}
          </span>
        ))}
      </div>

      {/* Фильтр по дням */}
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

      {loadError ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md p-10 text-center text-red-400">
          <div className="text-lg font-medium mb-2">Ошибка загрузки данных</div>
          <div className="text-sm">{loadError}</div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md border border-red-500/50 px-4 py-1.5 text-sm hover:bg-red-500/20 transition"
          >
            Перезагрузить страницу
          </button>
        </div>
      ) : loading && schedules.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground">
          Загрузка расписания...
        </div>
      ) : classes.length === 0 ? (
        <div className="bg-card border border-border rounded-md p-10 text-center text-muted-foreground">
          Нет уроков для выбранного дня.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div
            className="bg-card border border-border rounded-md overflow-x-auto relative"
            onClick={(e) => e.stopPropagation()}
          >
            {validating && (
              <div className="absolute top-2 right-2 z-10 inline-flex items-center gap-1.5 rounded-md bg-background/90 border border-border px-3 py-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Проверка конфликтов...
              </div>
            )}
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
                  const isCurrentLesson =
                    selectedDay === todayDow() && lesson === currentLesson;
                  return (
                    <tr
                      key={lesson}
                      className={`border-b border-border transition ${
                        isCurrentLesson ? "bg-card/50" : "hover:bg-card/30"
                      }`}
                    >
                      <td
                        className={`px-4 py-3 font-medium transition ${
                          isCurrentLesson ? "text-foreground font-bold" : "text-muted-foreground"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          {isCurrentLesson && (
                            <span className="w-2 h-2 rounded-full bg-foreground animate-pulse" />
                          )}
                          {lesson}
                        </div>
                      </td>
                      {classes.map((cls) => {
                        const s = grid[cls]?.[lesson];
                        const cellId = `${cls}|${lesson}`;
                        const isFlash =
                          flashConflict?.cellKey === cellId;
                        return (
                          <ScheduleCell
                            key={cls}
                            cellId={cellId}
                            schedule={s}
                            teacher={s?.teacher_id ? staff[s.teacher_id] : undefined}
                            heatmap={getHeatmapFor(
                              s?.teacher_id ?? null,
                              s?.day_of_week ?? (selectedDay === "all" ? null : Number(selectedDay))
                            )}
                            isCurrent={isCurrentLesson}
                            isFlashConflict={isFlash}
                            openCellKey={openCell}
                            onToggleCell={(k) =>
                              setOpenCell((prev) => (prev === k ? null : k))
                            }
                            onSick={handleSick}
                          />
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <DragOverlay dropAnimation={null}>
            {draggingSchedule ? (
              <div className="rounded-md border-2 border-primary bg-background/95 px-3 py-2 text-xs shadow-2xl pointer-events-none">
                <div className="font-semibold text-foreground">
                  {draggingSchedule.subject}
                </div>
                <div className="text-muted-foreground">
                  {draggingSchedule.class_name} · каб. {draggingSchedule.room || "—"}
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-md border px-4 py-3 shadow-xl text-sm ${
            toast.kind === "ok"
              ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-100"
              : "border-red-500/60 bg-red-500/15 text-red-100"
          }`}
        >
          <div className="flex items-start gap-2">
            {toast.kind === "ok" ? (
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            )}
            <span>{toast.message}</span>
          </div>
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

// ============================================================
// Ячейка с Draggable + Droppable
// ============================================================
function ScheduleCell({
  cellId,
  schedule,
  teacher,
  heatmap,
  isCurrent,
  isFlashConflict,
  openCellKey,
  onToggleCell,
  onSick,
}: {
  cellId: string;
  schedule?: Schedule;
  teacher?: Staff;
  heatmap: { lessons: number; gaps: number; level: number } | null;
  isCurrent: boolean;
  isFlashConflict: boolean;
  openCellKey: string | null;
  onToggleCell: (k: string) => void;
  onSick: (
    teacher: Staff,
    lesson: number,
    cls: string,
    day: number | null
  ) => void;
}) {
  // Droppable (любая ячейка таблицы)
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: cellId });

  // Draggable — только если есть урок
  return (
    <td
      ref={setDropRef}
      className={`px-2 py-2 align-top relative transition ${
        isCurrent ? "bg-card/50" : ""
      } ${
        isOver
          ? "bg-primary/10 ring-2 ring-primary"
          : ""
      } ${
        isFlashConflict
          ? "bg-red-500/30 ring-2 ring-red-500 animate-pulse"
          : ""
      }`}
    >
      {schedule ? (
        <DraggableLesson
          schedule={schedule}
          teacher={teacher}
          heatmap={heatmap}
          openCellKey={openCellKey}
          onToggleCell={onToggleCell}
          onSick={onSick}
        />
      ) : (
        <div className="min-h-[56px] flex items-center justify-center text-muted-foreground/40 text-xs italic">
          —
        </div>
      )}
    </td>
  );
}

function DraggableLesson({
  schedule,
  teacher,
  heatmap,
  openCellKey,
  onToggleCell,
  onSick,
}: {
  schedule: Schedule;
  teacher?: Staff;
  heatmap: { lessons: number; gaps: number; level: number } | null;
  openCellKey: string | null;
  onToggleCell: (k: string) => void;
  onSick: (
    teacher: Staff,
    lesson: number,
    cls: string,
    day: number | null
  ) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    transform,
  } = useDraggable({ id: String(schedule.id) });

  const cellKey = `open-${schedule.id}`;
  const isOpen = openCellKey === cellKey;
  const heatCls = heatmap ? HEATMAP_CLASSES[heatmap.level] || "" : "";
  const isTask = schedule.type === "task";
  const taskCls = isTask ? "bg-amber-500/10 border-amber-500/30" : "bg-card/50 border-border";

  return (
    <div
      ref={setNodeRef}
      className={`rounded-md p-2.5 border transition relative ${taskCls} ${heatCls} ${
        isDragging ? "opacity-40" : "hover:border-primary/60"
      }`}
      style={
        transform
          ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          {...listeners}
          {...attributes}
          className="mt-0.5 shrink-0 text-muted-foreground/60 hover:text-foreground cursor-grab active:cursor-grabbing"
          title={isTask ? "Перетащить задачу" : "Перетащить урок"}
          aria-label="Перетащить"
        >
          {isTask ? <Wrench className="h-4 w-4" /> : <GripVertical className="h-4 w-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-foreground truncate flex items-center gap-1.5">
            {schedule.subject}
            {isTask && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                Задача
              </span>
            )}
          </div>
          {schedule.room && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
              <MapPin className="h-3 w-3" />
              каб. {schedule.room}
            </div>
          )}

          {schedule.description && isTask && (
            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {schedule.description}
            </div>
          )}

          {teacher ? (
            <div className="relative inline-block mt-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCell(cellKey);
                }}
                className={`text-xs rounded px-1.5 py-0.5 transition border truncate max-w-[130px] ${
                  isOpen
                    ? "bg-primary/15 border-primary text-foreground"
                    : "bg-background/60 border-border hover:border-primary/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {teacher.fio}
              </button>
              {isOpen && !isTask && (
                <div
                  className="absolute z-30 mt-1 left-0 rounded-md border border-border bg-card shadow-xl p-2 min-w-[220px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="text-xs mb-2 px-1">
                    <div className="font-medium text-foreground">{teacher.fio}</div>
                    {teacher.specialization && (
                      <span className="block text-[11px] text-muted-foreground mt-0.5">
                        {teacher.specialization}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      schedule.class_name && onSick(
                        teacher,
                        schedule.lesson_number,
                        schedule.class_name,
                        schedule.day_of_week
                      )
                    }
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-background border border-border text-foreground hover:border-primary/60 px-3 py-1.5 text-xs font-medium transition"
                  >
                    <UserX className="h-3.5 w-3.5" />
                    Заболел
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic mt-1">
              учитель не назначен
            </div>
          )}
        </div>
      </div>

      {/* Индикатор heatmap */}
      {heatmap && heatmap.level >= 2 && (
        <div className="mt-1.5 pt-1.5 border-t border-border/50 flex items-center gap-1 text-[10px] text-orange-300">
          <Flame className="h-3 w-3" />
          <span>
            {heatmap.lessons} ур./день
            {heatmap.gaps > 0 && `, окон: ${heatmap.gaps}`}
          </span>
        </div>
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
          ? "bg-primary/15 border-primary text-foreground"
          : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-primary/50"
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
  onAssign: (id: number) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-md w-full max-w-lg shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-card">
          <div>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-muted-foreground" />
              Поиск замены
            </h3>
            <p className="text-xs text-muted-foreground mt-2">
              <span className="text-foreground font-medium">{data.absent.fio}</span>
              {" · "}
              <span className="text-foreground">{data.className}</span>, урок{" "}
              {data.lessonNumber}
              {data.dayOfWeek && ` · ${DAY_NAMES[data.dayOfWeek - 1]}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-card text-muted-foreground hover:text-foreground"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">
          {data.loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="text-sm">Ищем свободных педагогов...</span>
            </div>
          ) : data.error ? (
            <div className="py-8 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-500/15 mb-3">
                <X className="h-6 w-6 text-red-400" />
              </div>
              <div className="text-red-400 font-medium">{data.error}</div>
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
                  className="flex flex-col gap-2 rounded-md border border-border bg-card/50 px-4 py-3 hover:border-primary/60 hover:shadow-md transition cursor-pointer"
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
                  {c.warnings && c.warnings.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border space-y-0.5">
                      {c.warnings.map((w, idx) => (
                        <div
                          key={idx}
                          className="text-xs text-muted-foreground flex items-start gap-1"
                        >
                          <span>⚠️</span>
                          <span>{w}</span>
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
