"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { StaffScheduleView } from "@/components/staff-schedule-grid";

type Staff = {
  id: number;
  fio: string;
  role: string;
  category: string | null;
  specialization: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  director:      "Директор",
  vice_director: "Завуч",
  admin:         "Администрация",
  teacher:       "Учитель",
  maintenance:   "Техперсонал",
  kitchen:       "Столовая",
};

function categoryOrder(cat: string | null): number {
  if (cat === "admin") return 0;
  if (cat === "teacher") return 1;
  if (cat === "maintenance") return 2;
  if (cat === "kitchen") return 3;
  return 9;
}

export default function StaffSchedulePage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      // select("*") — устойчиво к отсутствию category (до миграции 015).
      const { data, error } = await supabase
        .from("staff")
        .select("*")
        .order("fio", { ascending: true });
      if (error) console.error("Error loading staff:", error);
      const list: Staff[] = ((data as any[]) || []).map((s) => ({
        id: s.id,
        fio: s.fio,
        role: s.role,
        category: s.category ?? null,
        specialization: s.specialization ?? null,
      }));
      // Сортируем по категориям, затем по ФИО
      list.sort((a, b) => {
        const d = categoryOrder(a.category) - categoryOrder(b.category);
        if (d !== 0) return d;
        return a.fio.localeCompare(b.fio, "ru");
      });
      setStaff(list);
      if (list.length > 0) setSelectedId(list[0].id);
      setLoading(false);
    }
    load();
  }, []);

  // Группы для выпадающего списка
  const groups = useMemo(() => {
    const by: Record<string, Staff[]> = {
      admin: [],
      teacher: [],
      maintenance: [],
      kitchen: [],
      other: [],
    };
    for (const s of staff) {
      const key = s.category && s.category in by ? s.category : "other";
      by[key].push(s);
    }
    return by;
  }, [staff]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-neon flex items-center gap-3">
          <CalendarDays className="h-8 w-8" />
          Общий график
        </h1>
        <p className="text-muted-foreground">
          Выберите любого сотрудника из списка, чтобы мгновенно увидеть его
          недельное расписание: уроки, дежурства, обходы.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted-foreground">Сотрудник:</label>
        <select
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(Number(e.target.value))}
          disabled={loading || staff.length === 0}
          className="min-w-[320px] rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
        >
          {loading && <option>Загрузка...</option>}
          {!loading && staff.length === 0 && (
            <option>Нет сотрудников</option>
          )}
          {!loading &&
            (["admin", "teacher", "maintenance", "kitchen", "other"] as const).map(
              (key) => {
                const items = groups[key];
                if (!items || items.length === 0) return null;
                const label =
                  key === "admin"
                    ? "Администрация"
                    : key === "teacher"
                    ? "Учителя"
                    : key === "maintenance"
                    ? "Техперсонал"
                    : key === "kitchen"
                    ? "Столовая"
                    : "Прочие";
                return (
                  <optgroup key={key} label={label}>
                    {items.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fio}
                        {s.specialization ? ` · ${s.specialization}` : ""}
                        {" — "}
                        {ROLE_LABELS[s.role] || s.role}
                      </option>
                    ))}
                  </optgroup>
                );
              }
            )}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаю список сотрудников...
        </div>
      ) : selectedId ? (
        <StaffScheduleView staffId={selectedId} />
      ) : null}
    </div>
  );
}
