"use client";

import { useEffect, useState } from "react";
import {
  ListTodo,
  CircleDot,
  Clock,
  CheckCircle2,
  User as UserIcon,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Mic,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type TaskStatus = "new" | "in_progress" | "done" | "cancelled";

type Task = {
  id: number;
  description: string;
  status: TaskStatus;
  assignee: string | null;
  due_date: string | null;
  source: "text" | "voice";
  created_by_tg_id: number;
  created_at: string;
};

type Column = {
  key: TaskStatus;
  title: string;
  icon: typeof CircleDot;
  accent: string;
};

const COLUMNS: Column[] = [
  { key: "new", title: "Новое", icon: CircleDot, accent: "text-red-400" },
  { key: "in_progress", title: "В работе", icon: Clock, accent: "text-amber-300" },
  { key: "done", title: "Готово", icon: CheckCircle2, accent: "text-emerald-400" },
];

const NEXT: Record<TaskStatus, TaskStatus | null> = {
  new: "in_progress",
  in_progress: "done",
  done: null,
  cancelled: null,
};
const PREV: Record<TaskStatus, TaskStatus | null> = {
  new: null,
  in_progress: "new",
  done: "in_progress",
  cancelled: null,
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function labelFor(status: TaskStatus): string {
  return COLUMNS.find((c) => c.key === status)?.title || status;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulsingIds, setPulsingIds] = useState<Set<number>>(new Set());
  const [updatingIds, setUpdatingIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .in("status", ["new", "in_progress", "done"])
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) console.error(error);
      setTasks((data as Task[]) || []);
      setLoading(false);
    }
    load();

    const channel = supabase
      .channel("tasks-board")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tasks" },
        (payload) => {
          const t = payload.new as Task;
          setTasks((prev) => [t, ...prev]);
          pulse(t.id);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tasks" },
        (payload) => {
          const t = payload.new as Task;
          setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)));
          pulse(t.id);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "tasks" },
        (payload) => {
          const old = payload.old as Task;
          setTasks((prev) => prev.filter((x) => x.id !== old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function pulse(id: number) {
    setPulsingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setPulsingIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }, 1800);
  }

  async function updateStatus(id: number, status: TaskStatus) {
    setUpdatingIds((p) => new Set(p).add(id));
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    const { error } = await supabase
      .from("tasks")
      .update({ status })
      .eq("id", id);
    setUpdatingIds((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
    if (error) alert("Ошибка: " + error.message);
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-glow flex items-center gap-3">
          <ListTodo className="h-8 w-8 text-neon" />
          Задачи
        </h1>
        <p className="text-muted-foreground flex items-center gap-2 flex-wrap">
          Доска задач. Новые поступают голосом — нажмите
          <span className="inline-flex items-center gap-1 text-primary">
            <Mic className="h-3.5 w-3.5" /> кнопку микрофона
          </span>
          в правом нижнем углу и продиктуйте поручение.
        </p>
      </header>

      {loading ? (
        <div className="p-12 text-center text-muted-foreground">Загрузка...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {COLUMNS.map((col) => {
            const items = tasks.filter((t) => t.status === col.key);
            const Icon = col.icon;
            return (
              <div
                key={col.key}
                className="bg-surface border border-neon rounded-xl flex flex-col min-h-[400px]"
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
                    items.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        isPulsing={pulsingIds.has(t.id)}
                        isUpdating={updatingIds.has(t.id)}
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

function TaskCard({
  task,
  isPulsing,
  isUpdating,
  onStatusChange,
}: {
  task: Task;
  isPulsing: boolean;
  isUpdating: boolean;
  onStatusChange: (id: number, status: TaskStatus) => void;
}) {
  const prev = PREV[task.status];
  const next = NEXT[task.status];
  return (
    <div
      className={`rounded-lg border p-3 bg-background/40 transition ${
        isPulsing
          ? "border-neon animate-pulse-neon shadow-neon"
          : "border-neon/40 hover:border-neon"
      } ${isUpdating ? "opacity-60" : ""}`}
    >
      <p className="text-sm leading-snug mb-2 break-words">{task.description}</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mb-2">
        {task.assignee && (
          <span className="inline-flex items-center gap-1 text-primary">
            <UserIcon className="h-3 w-3" />
            {task.assignee}
          </span>
        )}
        {task.due_date && (
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3 w-3" />
            до {task.due_date}
          </span>
        )}
        {task.source === "voice" && (
          <span className="inline-flex items-center gap-1 text-amber-300">
            <Mic className="h-3 w-3" />
            голос
          </span>
        )}
        <span>{fmt(task.created_at)}</span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={!prev || isUpdating}
          onClick={() => prev && onStatusChange(task.id, prev)}
          className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-neon/40 px-2 py-1.5 text-xs transition hover:bg-primary/10 hover:border-neon disabled:opacity-30 disabled:cursor-not-allowed"
          title={prev ? `В «${labelFor(prev)}»` : "Нет предыдущего статуса"}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Назад
        </button>
        <button
          type="button"
          disabled={!next || isUpdating}
          onClick={() => next && onStatusChange(task.id, next)}
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
