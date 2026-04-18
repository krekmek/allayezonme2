"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Users,
  X,
  Loader2,
  Search,
  Shield,
  GraduationCap,
  Wrench,
  UtensilsCrossed,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { StaffScheduleView } from "@/components/staff-schedule-grid";

type Staff = {
  id: number;
  fio: string;
  role: string;
  category: string | null;
  specialization: string | null;
  weekly_load: number;
  max_load: number;
  telegram_id: number | null;
};

type CategoryKey = "all" | "admin" | "teacher" | "maintenance" | "kitchen";

const CATEGORIES: {
  key: CategoryKey;
  label: string;
  icon: typeof Users;
}[] = [
  { key: "all",         label: "Все",            icon: Users },
  { key: "admin",       label: "Администрация",  icon: Shield },
  { key: "teacher",     label: "Учителя",        icon: GraduationCap },
  { key: "maintenance", label: "Техперсонал",    icon: Wrench },
  { key: "kitchen",     label: "Столовая",       icon: UtensilsCrossed },
];

const ROLE_LABELS: Record<string, string> = {
  director:      "Директор",
  vice_director: "Завуч",
  admin:         "Администрация",
  teacher:       "Учитель",
  maintenance:   "Техперсонал",
  kitchen:       "Столовая",
  cafeteria:     "Столовая",
  cook:          "Повар",
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] || role;
}

function loadColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 75) return "bg-amber-500";
  if (pct >= 50) return "bg-primary";
  return "bg-emerald-500";
}

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [category, setCategory] = useState<CategoryKey>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Staff | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);
      // select("*") — на случай, если миграции 015/016 ещё не применены
      // и в staff отсутствуют колонки category/weekly_load/max_load.
      const { data, error } = await supabase
        .from("staff")
        .select("*")
        .order("fio", { ascending: true });
      if (error) {
        console.error("Error loading staff:", error);
        setLoadError(error.message || "Не удалось загрузить сотрудников");
        setStaff([]);
      } else {
        const normalized: Staff[] = ((data as any[]) || []).map((s) => ({
          id: s.id,
          fio: s.fio,
          role: s.role,
          category: s.category ?? null,
          specialization: s.specialization ?? null,
          weekly_load: Number(s.weekly_load ?? 0),
          max_load: Number(s.max_load ?? 0),
          telegram_id: s.telegram_id ?? null,
        }));
        setStaff(normalized);
      }
      setLoading(false);
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staff.filter((s) => {
      if (category !== "all") {
        // Фоллбек: если category не проставлен, определяем по role
        const cat =
          s.category ||
          (s.role === "director" || s.role === "admin" || s.role === "vice_director"
            ? "admin"
            : s.role === "teacher"
            ? "teacher"
            : s.role === "maintenance"
            ? "maintenance"
            : s.role === "kitchen" || s.role === "cafeteria" || s.role === "cook"
            ? "kitchen"
            : null);
        if (cat !== category) return false;
      }
      if (q) {
        return (
          s.fio.toLowerCase().includes(q) ||
          (s.specialization || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [staff, category, query]);

  const countsByCategory = useMemo(() => {
    const c: Record<CategoryKey, number> = {
      all: staff.length,
      admin: 0,
      teacher: 0,
      maintenance: 0,
      kitchen: 0,
    };
    for (const s of staff) {
      const cat =
        (s.category as CategoryKey | null) ||
        (s.role === "director" || s.role === "admin" || s.role === "vice_director"
          ? "admin"
          : s.role === "teacher"
          ? "teacher"
          : s.role === "maintenance"
          ? "maintenance"
          : s.role === "kitchen" || s.role === "cafeteria" || s.role === "cook"
          ? "kitchen"
          : null);
      if (cat && cat in c) c[cat as CategoryKey]++;
    }
    return c;
  }, [staff]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-neon flex items-center gap-3">
          <Users className="h-8 w-8" />
          Коллектив
        </h1>
        <p className="text-muted-foreground">
          Все сотрудники школы: администрация, учителя, техперсонал, столовая.
          Кликните по карточке, чтобы увидеть персональное расписание и
          нагрузку.
        </p>
      </header>

      {/* Фильтры по категориям */}
      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIES.map((c) => {
          const Icon = c.icon;
          const active = category === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition ${
                active
                  ? "border-primary bg-primary/15 text-foreground shadow-neon-sm"
                  : "border-border bg-card hover:bg-card/70 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {c.label}
              <span
                className={`ml-1 text-xs rounded-full px-1.5 py-0.5 ${
                  active
                    ? "bg-primary/20 text-foreground"
                    : "bg-background/60 text-muted-foreground"
                }`}
              >
                {countsByCategory[c.key]}
              </span>
            </button>
          );
        })}

        <div className="ml-auto relative">
          <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по ФИО или специализации..."
            className="w-72 rounded-md border border-border bg-card pl-8 pr-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
      </div>

      {loadError && (
        <div className="rounded-md border border-red-500 bg-red-500/10 text-sm text-foreground px-3 py-2">
          <b>Ошибка загрузки:</b> {loadError}
          <div className="mt-1 text-xs text-muted-foreground">
            Если в staff отсутствуют поля <code>category</code>, <code>weekly_load</code>, <code>max_load</code> —
            примените миграции <code>015_staff_schedule.sql</code> и <code>016_seed_staff_full.sql</code> в Supabase.
          </div>
        </div>
      )}

      {/* Сетка карточек */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаю сотрудников...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-border bg-card p-6 text-center text-muted-foreground">
          Сотрудников не найдено.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((s) => {
            const pct =
              s.max_load > 0
                ? Math.min(100, Math.round((s.weekly_load / s.max_load) * 100))
                : 0;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(s)}
                className="text-left rounded-md border border-border bg-card p-4 transition hover:shadow-neon hover:-translate-y-0.5 hover:border-primary/60 space-y-3"
              >
                <div>
                  <div className="font-semibold text-foreground leading-snug">
                    {s.fio}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {roleLabel(s.role)}
                    {s.specialization ? ` · ${s.specialization}` : ""}
                  </div>
                </div>

                {s.max_load > 0 ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Нагрузка</span>
                      <span className="font-medium text-foreground">
                        {s.weekly_load}ч / {s.max_load}ч
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-background/70 overflow-hidden">
                      <div
                        className={`h-full transition-all ${loadColor(pct)}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground italic">
                    Нагрузка не учитывается
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Модалка профиля */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div className="w-full max-w-5xl max-h-[90vh] rounded-lg border border-border bg-card shadow-xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  {selected.fio}
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {roleLabel(selected.role)}
                  {selected.specialization ? ` · ${selected.specialization}` : ""}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-muted-foreground hover:text-foreground transition"
                aria-label="Закрыть"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <StaffScheduleView staffId={selected.id} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
