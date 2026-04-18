"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, UserX, Search, X, Loader2, CheckCircle2, Send, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { MarkAbsentButton } from "./mark-absent-button";

type Staff = {
  id: number;
  fio: string;
  role: string;
  specialization: string | null;
  telegram_id: number | null;
};

type Absence = {
  id: number;
  teacher_id: number;
  date: string;
  reason_text: string | null;
  voice_url: string | null;
  status: string;
  created_at: string;
  staff: Staff | null;
};

type Candidate = {
  id: number;
  fio: string;
  telegram_id: number | null;
  specialization: string | null;
  warnings: string[];
};

export function EmergencyAlerts() {
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAbsence, setSelectedAbsence] = useState<Absence | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  async function cancelAbsence(absence: Absence) {
    const fio = absence.staff?.fio || "учителя";
    if (!confirm(`Отменить отсутствие ${fio}?`)) return;
    setCancellingId(absence.id);
    try {
      const resp = await fetch(
        `http://localhost:8001/api/absences/${absence.id}/cancel`,
        { method: "POST" }
      );
      const data = await resp.json();
      if (!data.ok) {
        alert("Не удалось отменить: " + (data.error || "ошибка"));
      }
      // Realtime подтянет изменение, но перегружаем для мгновенного UX
      await loadAbsences();
    } catch (e: any) {
      alert("Ошибка сети: " + e?.message);
    } finally {
      setCancellingId(null);
    }
  }

  // Обработчик: директор отметил учителя заболевшим → автоматически открываем замену
  function handleAbsenceCreated(payload: {
    absence_id: number;
    teacher: Staff;
    reason_text: string;
  }) {
    const newAbsence: Absence = {
      id: payload.absence_id,
      teacher_id: payload.teacher.id,
      date: new Date().toISOString().slice(0, 10),
      reason_text: payload.reason_text,
      voice_url: null,
      status: "pending",
      created_at: new Date().toISOString(),
      staff: payload.teacher,
    };
    // Сразу открываем модалку замены
    setSelectedAbsence(newAbsence);
    // Перегружаем список (realtime тоже сработает, но быстрее сразу обновить)
    loadAbsences();
  }

  async function loadAbsences() {
    try {
      const resp = await fetch("http://localhost:8001/api/absences");
      if (!resp.ok) throw new Error("Failed to load");
      const data: Absence[] = await resp.json();
      setAbsences(data);
    } catch (e) {
      console.error("Error loading absences:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAbsences();

    // Realtime-подписка
    const channel = supabase
      .channel("absences-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "absences" },
        () => {
          loadAbsences();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading) {
    return (
      <section className="bg-card border border-border rounded-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-5 w-5 text-foreground" />
          <h2 className="text-xl font-semibold text-foreground">Срочные уведомления</h2>
        </div>
        <p className="text-muted-foreground">Загрузка...</p>
      </section>
    );
  }

  if (absences.length === 0) {
    return (
      <>
        <section className="bg-card border border-border rounded-md p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-5 w-5 text-foreground" />
            <h2 className="text-xl font-semibold text-foreground">Срочные уведомления</h2>
            <div className="ml-auto">
              <MarkAbsentButton onAbsenceCreated={handleAbsenceCreated} />
            </div>
          </div>
          <p className="text-muted-foreground">Нет активных заявок об отсутствии</p>
        </section>

        {selectedAbsence && (
          <SubstitutionModal
            absence={selectedAbsence}
            onClose={() => setSelectedAbsence(null)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <section className="bg-card border border-border rounded-md p-6">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <AlertTriangle className="h-5 w-5 text-foreground animate-pulse" />
          <h2 className="text-xl font-semibold text-foreground">Срочные уведомления</h2>
          <span className="text-xs px-2 py-1 rounded-full bg-card border border-border text-muted-foreground">
            {absences.length} активных
          </span>
          <div className="ml-auto">
            <MarkAbsentButton onAbsenceCreated={handleAbsenceCreated} />
          </div>
        </div>

        <div className="space-y-3">
          {absences.map((absence, idx) => (
            <div
              key={absence.id}
              className="border border-border rounded-md p-4 bg-card/50 animate-in slide-in-from-left-4"
              style={{ animationDelay: `${idx * 80}ms` }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="rounded-full bg-card border border-border p-2 text-foreground">
                    <UserX className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div>
                      <div className="font-medium text-foreground">
                        {absence.staff?.fio || "Неизвестный учитель"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {absence.staff?.specialization || "—"} ·{" "}
                        {new Date(absence.created_at).toLocaleString("ru-RU")}
                      </div>
                    </div>

                    {absence.reason_text && (
                      <div className="text-sm text-foreground bg-card rounded px-3 py-2 border border-border">
                        {absence.reason_text}
                      </div>
                    )}

                    {absence.voice_url && (
                      <audio
                        controls
                        src={absence.voice_url}
                        className="w-full max-w-md h-8"
                      />
                    )}
                  </div>
                </div>

                <div className="shrink-0 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedAbsence(absence)}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-md bg-card border border-border text-foreground hover:bg-card/50 transition"
                  >
                    <Search className="h-4 w-4" />
                    Найти замену
                  </button>
                  <button
                    type="button"
                    onClick={() => cancelAbsence(absence)}
                    disabled={cancellingId === absence.id}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-card/50 transition disabled:opacity-40"
                    title="Отметили по ошибке? Отмените"
                  >
                    {cancellingId === absence.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Отменить
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {selectedAbsence && (
        <SubstitutionModal
          absence={selectedAbsence}
          onClose={() => setSelectedAbsence(null)}
        />
      )}
    </>
  );
}

function SubstitutionModal({
  absence,
  onClose,
}: {
  absence: Absence;
  onClose: () => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [lessonNumber, setLessonNumber] = useState(1);
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function loadCandidates() {
    setLoading(true);
    try {
      const today = new Date();
      const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay();

      const resp = await fetch(
        `http://localhost:8001/api/substitution/${absence.teacher_id}?lesson_number=${lessonNumber}&day_of_week=${dayOfWeek}`
      );
      if (!resp.ok) throw new Error("Failed to load");
      const data = await resp.json();
      setCandidates(data.candidates || []);
    } catch (e) {
      console.error("Error loading candidates:", e);
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }

  async function assignCandidate(cand: Candidate) {
    setAssigningId(cand.id);
    setResult(null);
    try {
      const resp = await fetch(
        "http://localhost:8001/api/request-substitution",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            absent_teacher_id: absence.teacher_id,
            candidate_id: cand.id,
            absence_id: absence.id,
            lesson_number: lessonNumber,
            reason: absence.reason_text || "Учитель отсутствует",
          }),
        }
      );
      const data = await resp.json();
      setResult({
        ok: !!data.ok,
        message: data.ok
          ? `✅ Замена создана${data.notified ? `, уведомление отправлено: ${cand.fio}` : " (push не доставлен)"}`
          : `❌ ${data.error || data.message || "Ошибка"}`,
      });
    } catch (e: any) {
      setResult({ ok: false, message: `❌ Ошибка сети: ${e?.message || e}` });
    } finally {
      setAssigningId(null);
    }
  }

  useEffect(() => {
    loadCandidates();
  }, [lessonNumber]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-md max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Назначить замену</h3>
            <p className="text-sm text-muted-foreground">
              Отсутствует: <b className="text-foreground">{absence.staff?.fio}</b> · {absence.staff?.specialization}
            </p>
            {absence.reason_text && (
              <p className="text-xs text-muted-foreground mt-1 italic">
                Причина: {absence.reason_text}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Урок №:</label>
            <select
              value={lessonNumber}
              onChange={(e) => setLessonNumber(Number(e.target.value))}
              className="bg-card border border-border rounded px-3 py-1.5 text-sm text-foreground"
            >
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          {result && (
            <div
              className={`text-sm rounded-lg px-3 py-2 border ${
                result.ok
                  ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
                  : "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300"
              }`}
            >
              {result.message}
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Поиск кандидатов...
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-muted-foreground">
              Нет подходящих кандидатов для этого урока.
            </p>
          ) : (
            <div className="space-y-2">
              {candidates.map((cand) => (
                <div
                  key={cand.id}
                  className="flex items-start justify-between gap-3 p-3 rounded-md border border-border bg-card/50"
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <CheckCircle2 className="h-5 w-5 text-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{cand.fio}</div>
                      <div className="text-xs text-muted-foreground">
                        {cand.specialization || "—"}
                        {!cand.telegram_id && (
                          <span className="ml-2 text-muted-foreground">· нет Telegram</span>
                        )}
                      </div>
                      {cand.warnings && cand.warnings.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {cand.warnings.map((w, i) => (
                            <div
                              key={i}
                              className="text-xs text-muted-foreground flex items-center gap-1"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {w}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => assignCandidate(cand)}
                    disabled={assigningId === cand.id || !cand.telegram_id}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-card border border-border text-foreground hover:bg-card/50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {assigningId === cand.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Назначить
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
