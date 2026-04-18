"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

export type ScheduleSlot = {
  id: number;
  staff_id: number;
  day_of_week: number;
  time_slot: number;
  location: string | null;
  task_description: string;
  task_type: string;
  class_name: string | null;
};

export type StaffCard = {
  id: number;
  fio: string;
  role: string;
  category: string | null;
  specialization: string | null;
  weekly_load: number;
  max_load: number;
  telegram_id: number | null;
};

export type ScheduleData = {
  staff: StaffCard;
  slots: ScheduleSlot[];
  by_day: Record<string, ScheduleSlot[]>;
  weekly_load: number;
  max_load: number;
  load_percent: number;
};

const DAYS = [
  { idx: 1, label: "Пн" },
  { idx: 2, label: "Вт" },
  { idx: 3, label: "Ср" },
  { idx: 4, label: "Чт" },
  { idx: 5, label: "Пт" },
  { idx: 6, label: "Сб" },
  { idx: 7, label: "Вс" },
];

const TASK_COLORS: Record<string, string> = {
  lesson:     "border-primary/60 bg-primary/10 text-foreground",
  duty:       "border-amber-500/60 bg-amber-500/10 text-amber-100",
  guard:      "border-orange-500/60 bg-orange-500/10 text-orange-100",
  cafeteria:  "border-emerald-500/60 bg-emerald-500/10 text-emerald-100",
  admin:      "border-sky-500/60 bg-sky-500/10 text-sky-100",
  maintenance:"border-violet-500/60 bg-violet-500/10 text-violet-100",
};

function loadBarColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 75) return "bg-amber-500";
  if (pct >= 50) return "bg-primary";
  return "bg-emerald-500";
}

export function StaffScheduleView({ staffId }: { staffId: number }) {
  const [data, setData] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`/api/staff/schedule/${staffId}`);
        const json = await resp.json();
        if (!resp.ok) throw new Error(json?.error || "Ошибка загрузки");
        if (!cancelled) setData(json as ScheduleData);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Сетевая ошибка");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [staffId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загружаю график...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-500 bg-red-500/10 text-sm text-foreground px-3 py-2">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return <ScheduleContent data={data} />;
}

export function ScheduleContent({ data }: { data: ScheduleData }) {
  const { staff, by_day, weekly_load, max_load, load_percent } = data;

  // Макс время-слот среди всех (чтобы сетка не была пустой)
  const maxSlot = useMemo(() => {
    let m = 5;
    for (const day of Object.values(by_day)) {
      for (const s of day) if (s.time_slot > m) m = s.time_slot;
    }
    return m;
  }, [by_day]);

  const slotRows = Array.from({ length: maxSlot }, (_, i) => i + 1);
  const barColor = loadBarColor(load_percent);

  return (
    <div className="space-y-5">
      {/* Карточка с нагрузкой */}
      <div className="rounded-md border border-border bg-card px-4 py-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Недельная нагрузка</span>
          <span className="font-semibold text-foreground">
            {weekly_load} / {max_load} ч
          </span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-background/70 overflow-hidden">
          <div
            className={`h-full ${barColor} transition-all duration-500`}
            style={{ width: `${load_percent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{staff.role}</span>
          <span>{load_percent}%</span>
        </div>
      </div>

      {/* Сетка расписания на неделю */}
      <div className="rounded-md border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-background/50 border-b border-border">
              <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground w-16">
                Слот
              </th>
              {DAYS.map((d) => (
                <th
                  key={d.idx}
                  className="px-2 py-2 text-center text-xs font-medium text-foreground"
                >
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slotRows.map((slot) => (
              <tr key={slot} className="border-b border-border/60 last:border-0">
                <td className="px-2 py-1.5 text-xs text-muted-foreground font-mono">
                  {slot}
                </td>
                {DAYS.map((d) => {
                  const cell = by_day[String(d.idx)]?.find(
                    (s) => s.time_slot === slot
                  );
                  return (
                    <td key={d.idx} className="px-1 py-1 align-top min-w-[110px]">
                      {cell ? (
                        <div
                          className={`rounded-md border px-2 py-1.5 text-xs leading-tight ${
                            TASK_COLORS[cell.task_type] ||
                            "border-border bg-background/40 text-foreground"
                          }`}
                        >
                          <div className="font-medium line-clamp-2">
                            {cell.task_description}
                          </div>
                          {cell.location && (
                            <div className="opacity-70 mt-0.5">
                              📍 {cell.location}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="h-full" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {slotRows.length === 0 && (
              <tr>
                <td
                  colSpan={DAYS.length + 1}
                  className="px-4 py-6 text-center text-sm text-muted-foreground"
                >
                  Нет записей в расписании
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
