"use client";

import { useEffect, useState } from "react";
import { UserX, X, Loader2, Search } from "lucide-react";

type Staff = {
  id: number;
  fio: string;
  role: string;
  specialization: string | null;
  telegram_id: number | null;
};

type Props = {
  /** Вызывается после создания заявки: передаётся absence_id, teacher (для открытия модалки замены). */
  onAbsenceCreated: (payload: {
    absence_id: number;
    teacher: Staff;
    reason_text: string;
  }) => void;
};

export function MarkAbsentButton({ onAbsenceCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [reason, setReason] = useState("Заболел");
  const [error, setError] = useState<string | null>(null);

  async function loadStaff() {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("http://localhost:8001/api/staff");
      if (!resp.ok) throw new Error("Не удалось загрузить список");
      const data: Staff[] = await resp.json();
      // Только учителя
      setStaff(data.filter((s) => s.role === "teacher"));
    } catch (e: any) {
      setError(e?.message || "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) loadStaff();
  }, [open]);

  async function markAbsent(teacher: Staff) {
    setSubmitting(teacher.id);
    setError(null);
    try {
      const resp = await fetch("http://localhost:8001/api/absences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacher_id: teacher.id,
          reason_text: reason || "Заболел",
        }),
      });
      const data = await resp.json();
      if (!data.ok) {
        setError(data.error || "Не удалось создать заявку");
        return;
      }

      setOpen(false);
      onAbsenceCreated({
        absence_id: data.absence.id,
        teacher,
        reason_text: reason || "Заболел",
      });
    } catch (e: any) {
      setError(e?.message || "Ошибка сети");
    } finally {
      setSubmitting(null);
    }
  }

  const filtered = staff.filter((s) =>
    `${s.fio} ${s.specialization || ""}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-500/50 bg-red-500/10 text-red-200 hover:bg-red-500/20 transition"
      >
        <UserX className="h-4 w-4" />
        <span>Отметить заболевшего</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="modal-content border border-neon rounded-xl max-w-xl w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-neon">
              <div>
                <h3 className="text-lg font-semibold">Отметить заболевшего</h3>
                <p className="text-sm text-muted-foreground">
                  Выберите учителя — после этого откроется окно поиска замены
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-3 overflow-y-auto">
              <div>
                <label className="text-xs text-muted-foreground">
                  Причина отсутствия
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Например: Заболел"
                  className="w-full bg-background border border-neon rounded px-3 py-2 text-sm mt-1"
                />
              </div>

              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Поиск учителя по ФИО или предмету..."
                  className="w-full bg-background border border-neon rounded pl-8 pr-3 py-2 text-sm"
                />
              </div>

              {error && (
                <div className="text-sm rounded-lg px-3 py-2 border bg-red-500/10 border-red-500/40 text-red-200">
                  {error}
                </div>
              )}

              {loading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Загрузка списка...
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-muted-foreground text-sm py-2">
                  {query ? "Ничего не найдено" : "Список пуст"}
                </p>
              ) : (
                <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                  {filtered.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg border border-neon/40 bg-background/40 hover:border-neon"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{t.fio}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.specialization || "—"}
                          {!t.telegram_id && (
                            <span className="ml-2 text-amber-400">
                              · нет Telegram
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => markAbsent(t)}
                        disabled={submitting === t.id}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-red-500/15 border border-red-500/50 text-red-200 hover:bg-red-500/25 transition disabled:opacity-40"
                      >
                        {submitting === t.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <UserX className="h-4 w-4" />
                        )}
                        Заболел
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
