"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Clock,
  CheckCircle2,
  MapPin,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type IncidentStatus = "new" | "in_progress" | "resolved" | "cancelled";

type Incident = {
  id: number;
  description: string;
  status: IncidentStatus;
  location: string | null;
  created_by_tg_id: number;
  created_at: string;
};

type Column = {
  key: IncidentStatus;
  title: string;
  icon: typeof AlertTriangle;
  accent: string;
};

const COLUMNS: Column[] = [
  { key: "new", title: "Новое", icon: AlertTriangle, accent: "text-red-400" },
  {
    key: "in_progress",
    title: "В работе",
    icon: Clock,
    accent: "text-amber-300",
  },
  {
    key: "resolved",
    title: "Решено",
    icon: CheckCircle2,
    accent: "text-emerald-400",
  },
];

// Следующий и предыдущий статус для стрелок на карточке
const NEXT_STATUS: Record<IncidentStatus, IncidentStatus | null> = {
  new: "in_progress",
  in_progress: "resolved",
  resolved: null,
  cancelled: null,
};
const PREV_STATUS: Record<IncidentStatus, IncidentStatus | null> = {
  new: null,
  in_progress: "new",
  resolved: "in_progress",
  cancelled: null,
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulsingIds, setPulsingIds] = useState<Set<number>>(new Set());
  const [updatingIds, setUpdatingIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("incidents")
        .select("*")
        .in("status", ["new", "in_progress", "resolved"])
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        console.error("Error loading incidents:", error);
        setLoading(false);
        return;
      }
      setIncidents((data as Incident[]) || []);
      setLoading(false);
    }
    load();

    const channel = supabase
      .channel("incidents-board")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "incidents" },
        (payload) => {
          const incident = payload.new as Incident;
          setIncidents((prev) => [incident, ...prev]);
          markPulse(incident.id);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "incidents" },
        (payload) => {
          const updated = payload.new as Incident;
          setIncidents((prev) =>
            prev.map((i) => (i.id === updated.id ? updated : i))
          );
          markPulse(updated.id);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "incidents" },
        (payload) => {
          const old = payload.old as Incident;
          setIncidents((prev) => prev.filter((i) => i.id !== old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function markPulse(id: number) {
    setPulsingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setTimeout(() => {
      setPulsingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 1800);
  }

  async function updateStatus(id: number, status: IncidentStatus) {
    // Оптимистичное обновление локально
    setUpdatingIds((prev) => new Set(prev).add(id));
    setIncidents((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status } : i))
    );

    const { error } = await supabase
      .from("incidents")
      .update({ status })
      .eq("id", id);

    setUpdatingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    if (error) {
      console.error("Failed to update status:", error);
      alert("Не удалось обновить статус: " + error.message);
      // Откат: перезагружаем
      const { data } = await supabase
        .from("incidents")
        .select("*")
        .eq("id", id)
        .single();
      if (data) {
        setIncidents((prev) =>
          prev.map((i) => (i.id === id ? (data as Incident) : i))
        );
      }
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-neon flex items-center gap-3">
          <AlertTriangle className="h-8 w-8 text-neon" />
          Инциденты
        </h1>
        <p className="text-muted-foreground">
          Доска задач по поломкам и проблемам. Клик по стрелкам меняет статус — база
          обновляется мгновенно.
        </p>
      </header>

      {loading ? (
        <div className="p-12 text-center text-muted-foreground">
          Загрузка инцидентов...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {COLUMNS.map((col) => {
            const items = incidents.filter((i) => i.status === col.key);
            const Icon = col.icon;
            return (
              <div
                key={col.key}
                className="bg-card border border-neon rounded-md flex flex-col min-h-[400px]"
              >
                <div className="px-5 py-4 border-b border-neon flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-5 w-5 ${col.accent}`} />
                    <h2 className="font-semibold">{col.title}</h2>
                  </div>
                  <span className="text-xs rounded-full bg-primary/10 text-primary px-2.5 py-1 font-medium">
                    {items.length}
                  </span>
                </div>

                <div className="p-3 flex flex-col gap-3 flex-1">
                  {items.length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground py-10">
                      Пусто
                    </div>
                  ) : (
                    items.map((inc) => (
                      <IncidentCard
                        key={inc.id}
                        incident={inc}
                        isPulsing={pulsingIds.has(inc.id)}
                        isUpdating={updatingIds.has(inc.id)}
                        onStatusChange={updateStatus}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IncidentCard({
  incident,
  isPulsing,
  isUpdating,
  onStatusChange,
}: {
  incident: Incident;
  isPulsing: boolean;
  isUpdating: boolean;
  onStatusChange: (id: number, status: IncidentStatus) => void;
}) {
  const prev = PREV_STATUS[incident.status];
  const next = NEXT_STATUS[incident.status];

  return (
    <div
      className={`rounded-md border p-3 bg-background/40 transition ${
        isPulsing
          ? "border-neon animate-pulse-neon shadow-neon"
          : "border-neon/40 hover:border-neon"
      } ${isUpdating ? "opacity-60" : ""}`}
    >
      <p className="text-sm leading-snug mb-3 break-words">
        {incident.description}
      </p>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          {incident.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {incident.location}
            </span>
          )}
          <span>{formatTime(incident.created_at)}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={!prev || isUpdating}
          onClick={() => prev && onStatusChange(incident.id, prev)}
          className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-neon/40 px-2 py-1.5 text-xs transition hover:bg-primary/10 hover:border-neon disabled:opacity-30 disabled:cursor-not-allowed"
          title={prev ? `В «${labelFor(prev)}»` : "Нет предыдущего статуса"}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Назад
        </button>
        <button
          type="button"
          disabled={!next || isUpdating}
          onClick={() => next && onStatusChange(incident.id, next)}
          className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-primary/15 border border-neon px-2 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/25 hover:shadow-neon disabled:opacity-30 disabled:cursor-not-allowed"
          title={next ? `В «${labelFor(next)}»` : "Последний статус"}
        >
          {next ? `В «${labelFor(next)}»` : "Готово"}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function labelFor(status: IncidentStatus): string {
  const c = COLUMNS.find((col) => col.key === status);
  return c ? c.title : status;
}
