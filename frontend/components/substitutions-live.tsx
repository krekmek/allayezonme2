"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, XCircle, UserCheck } from "lucide-react";
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
    <section className="bg-surface border border-neon rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <UserCheck className="h-5 w-5 text-emerald-400" />
        <h2 className="text-xl font-semibold">Замены</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          обновляется в реальном времени
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {subs.map((sub) => (
          <SubCard key={sub.id} sub={sub} />
        ))}
      </div>
    </section>
  );
}

function SubCard({ sub }: { sub: Substitution }) {
  const styles = {
    pending: {
      border: "border-amber-500/50",
      bg: "bg-amber-500/10",
      icon: <Clock className="h-4 w-4 text-amber-400" />,
      label: "Ожидает подтверждения",
      labelCls: "text-amber-300",
    },
    confirmed: {
      border: "border-emerald-500",
      bg: "bg-emerald-500/15 shadow-neon",
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
      label: "Подтверждено",
      labelCls: "text-emerald-300",
    },
    declined: {
      border: "border-red-500/50",
      bg: "bg-red-500/10",
      icon: <XCircle className="h-4 w-4 text-red-400" />,
      label: "Отклонено",
      labelCls: "text-red-300",
    },
  }[sub.status];

  return (
    <div
      className={`rounded-lg border ${styles.border} ${styles.bg} p-4 transition-all animate-in fade-in`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs">
          {styles.icon}
          <span className={styles.labelCls}>{styles.label}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {sub.class_name ? `Класс ${sub.class_name}` : "Класс —"} · Урок{" "}
          {sub.lesson_number ?? "—"}
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
          <span className="font-semibold">{sub.substitute?.fio || "—"}</span>
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
