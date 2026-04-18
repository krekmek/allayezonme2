"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, XCircle, UserCheck, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Staff = { id: number; fio: string; specialization: string | null };

type Substitution = {
  id: number;
  absent_teacher_id: number;
  substitute_teacher_id: number;
  class_name: string | null;
  lesson_number: number | null;
  subject: string | null;
  room: string | null;
  reason: string | null;
  status: "pending" | "confirmed" | "declined";
  created_at: string;
  confirmed_at: string | null;
  absent: Staff | null;
  substitute: Staff | null;
};

export function SubstitutionsLive() {
  const [subs, setSubs] = useState<Substitution[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadSubs() {
    try {
      const { data, error } = await supabase
        .from("substitutions")
        .select(
          "*, absent:absent_teacher_id(id, fio, specialization), substitute:substitute_teacher_id(id, fio, specialization)"
        )
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        console.error("Error loading substitutions:", error);
        return;
      }
      setSubs((data as Substitution[]) || []);
    } finally {
      setLoading(false);
    }
  }

  function handleDelete(id: number) {
    setSubs((prev) => prev.filter((s) => s.id !== id));
  }

  useEffect(() => {
    loadSubs();

    const channel = supabase
      .channel("substitutions-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "substitutions" },
        () => {
          loadSubs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading) return null;
  if (subs.length === 0) return null;

  return (
    <section className="bg-card border border-border rounded-md p-6">
      <div className="flex items-center gap-2 mb-4">
        <UserCheck className="h-5 w-5 text-foreground" />
        <h2 className="text-xl font-semibold text-foreground">Замены</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          обновляется в реальном времени
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {subs.map((sub) => (
          <SubCard key={sub.id} sub={sub} onDelete={handleDelete} />
        ))}
      </div>
    </section>
  );
}

function SubCard({ sub, onDelete }: { sub: Substitution; onDelete: (id: number) => void }) {
  const [deleting, setDeleting] = useState(false);

  const styles = {
    pending: {
      dotColor: "bg-yellow-500",
      label: "Ожидает подтверждения",
    },
    confirmed: {
      dotColor: "bg-emerald-500",
      label: "Подтверждено",
    },
    declined: {
      dotColor: "bg-red-500",
      label: "Отклонено",
    },
  }[sub.status];

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
      const resp = await fetch(`${API_BASE}/api/substitutions/${sub.id}`, {
        method: "DELETE",
      });
      if (resp.ok) {
        onDelete(sub.id);
      }
    } catch (e) {
      console.error("Failed to delete substitution:", e);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="rounded-md border border-border bg-card/50 p-4 transition-all animate-in fade-in"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs">
          <span className={`w-2 h-2 rounded-full ${styles.dotColor}`} />
          <span className="text-foreground">{styles.label}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">
            {sub.class_name ? `Класс ${sub.class_name}` : "Класс —"} · Урок{" "}
            {sub.lesson_number ?? "—"}
          </div>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="text-muted-foreground hover:text-red-500 transition disabled:opacity-50"
            title="Удалить заявку"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="text-sm space-y-1">
        <div>
          <span className="text-muted-foreground">Вместо: </span>
          <span className="line-through text-muted-foreground">
            {sub.absent?.fio || "—"}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Заменяет: </span>
          <span className="font-semibold text-foreground">{sub.substitute?.fio || "—"}</span>
        </div>
        {sub.reason && (
          <div className="text-xs text-muted-foreground italic mt-1">
            Причина: {sub.reason}
          </div>
        )}
      </div>
    </div>
  );
}
