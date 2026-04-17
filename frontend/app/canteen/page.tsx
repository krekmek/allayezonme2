"use client";

import { useEffect, useState } from "react";
import { Utensils, Users, TrendingUp, Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";

type AttendanceReport = {
  id: number;
  class_name: string | null;
  present_count: number;
  absent_count: number;
  absent_list: string[] | null;
  portions: number;
  raw_text: string | null;
  created_at: string;
};

type AttendanceRow = {
  id: number;
  className: string;
  presentCount: number;
  absentCount: number;
  absentList: string[];
  portions: number;
  time: string;
  isPulsing: boolean;
};

function toRow(r: AttendanceReport, isPulsing = false): AttendanceRow {
  return {
    id: r.id,
    className: r.class_name || "—",
    presentCount: r.present_count || 0,
    absentCount: r.absent_count || 0,
    absentList: r.absent_list || [],
    portions: r.portions || 0,
    time: new Date(r.created_at).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    isPulsing,
  };
}

export default function CanteenPage() {
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [totalPortions, setTotalPortions] = useState(0);
  const [loading, setLoading] = useState(true);

  // Загрузка начальных данных
  useEffect(() => {
    async function loadInitialData() {
      setLoading(true);
      const { data, error } = await supabase
        .from("attendance_reports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("Error loading attendance reports:", error);
        setLoading(false);
        return;
      }

      const processed = (data as AttendanceReport[] | null || []).map((r) =>
        toRow(r)
      );
      setRows(processed);
      setTotalPortions(processed.reduce((sum, r) => sum + r.portions, 0));
      setLoading(false);
    }

    loadInitialData();

    // Realtime подписка на INSERT в attendance_reports
    const channel = supabase
      .channel("canteen-attendance")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "attendance_reports",
        },
        (payload) => {
          const newRow = toRow(payload.new as AttendanceReport, true);
          setRows((prev) => [newRow, ...prev]);
          setTotalPortions((prev) => prev + newRow.portions);

          // Убираем пульсацию через 2 секунды
          setTimeout(() => {
            setRows((prev) =>
              prev.map((r) =>
                r.id === newRow.id ? { ...r, isPulsing: false } : r
              )
            );
          }, 2000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-glow flex items-center gap-3">
          <Utensils className="h-8 w-8 text-neon" />
          Столовая
        </h1>
        <p className="text-muted-foreground">
          Присутствие в реальном времени. Данные поступают от учителей через Telegram-бот.
        </p>
      </header>

      {/* Счётчик порций */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface border border-neon rounded-xl p-5 transition hover:shadow-neon">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary shadow-neon-sm">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Отчётов сегодня</p>
              <p className="text-2xl font-semibold text-glow">{rows.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-surface border border-neon rounded-xl p-5 transition hover:shadow-neon">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-neon/10 p-2 text-neon shadow-neon-sm animate-pulse-neon">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Итого порций</p>
              <p className="text-2xl font-semibold text-glow">{totalPortions}</p>
            </div>
          </div>
        </div>

        <div className="bg-surface border border-neon rounded-xl p-5 transition hover:shadow-neon">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary shadow-neon-sm">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Последний отчёт</p>
              <p className="text-lg font-semibold">
                {rows.length > 0 ? rows[0].time : "—"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Таблица присутствующих */}
      <div className="bg-surface border border-neon rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-neon">
          <h2 className="text-lg font-semibold">Таблица присутствующих</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-muted-foreground">
            Загрузка данных...
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            Нет отчётов за сегодня. Учитель может отправить отчёт через /report в боте.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-neon bg-primary/5">
                  <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Время</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Класс</th>
                  <th className="px-6 py-3 text-right text-sm font-medium text-muted-foreground">Присутствует</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Отсутствуют</th>
                  <th className="px-6 py-3 text-right text-sm font-medium text-muted-foreground">Порций</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-b border-neon/30 transition ${
                      row.isPulsing
                        ? "bg-neon/10 animate-pulse-neon"
                        : "hover:bg-primary/5"
                    }`}
                  >
                    <td className="px-6 py-4 text-sm text-muted-foreground">{row.time}</td>
                    <td className="px-6 py-4 text-sm font-medium">{row.className}</td>
                    <td className="px-6 py-4 text-right text-sm">{row.presentCount}</td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {row.absentList.length > 0 ? row.absentList.join(", ") : "—"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span
                        className={`inline-flex items-center justify-center rounded-full px-3 py-1 text-sm font-semibold ${
                          row.isPulsing
                            ? "bg-neon text-white shadow-neon"
                            : "bg-primary/10 text-primary"
                        }`}
                      >
                        {row.portions}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
