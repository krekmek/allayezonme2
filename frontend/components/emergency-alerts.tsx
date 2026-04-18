"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, UserX, Search, X, Loader2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

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
      <section className="bg-surface border border-neon rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-5 w-5 text-red-400" />
          <h2 className="text-xl font-semibold">Срочные уведомления</h2>
        </div>
        <p className="text-muted-foreground">Загрузка...</p>
      </section>
    );
  }

  if (absences.length === 0) {
    return (
      <section className="bg-surface border border-neon rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-5 w-5 text-red-400" />
          <h2 className="text-xl font-semibold">Срочные уведомления</h2>
        </div>
        <p className="text-muted-foreground">Нет активных заявок об отсутствии</p>
      </section>
    );
  }

  return (
    <>
      <section className="bg-surface border border-red-500/50 rounded-xl p-6 shadow-neon">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-5 w-5 text-red-400 animate-pulse" />
          <h2 className="text-xl font-semibold">Срочные уведомления</h2>
          <span className="ml-auto text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-300 border border-red-500">
            {absences.length} активных
          </span>
        </div>

        <div className="space-y-3">
          {absences.map((absence, idx) => (
            <div
              key={absence.id}
              className="border border-red-500/40 rounded-lg p-4 bg-red-500/5 animate-in slide-in-from-left-4"
              style={{ animationDelay: `${idx * 80}ms` }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="rounded-full bg-red-500/20 p-2 text-red-300">
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
                      <div className="text-sm text-foreground/90 bg-background/40 rounded px-3 py-2 border border-neon/20">
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

                <button
                  type="button"
                  onClick={() => setSelectedAbsence(absence)}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-primary/15 border border-neon text-primary hover:bg-primary/25 transition"
                >
                  <Search className="h-4 w-4" />
                  Найти замену
                </button>
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

  useEffect(() => {
    loadCandidates();
  }, [lessonNumber]);

  return (
    <div
      className="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="modal-content border border-neon rounded-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-neon">
          <div>
            <h3 className="text-lg font-semibold">Поиск замены</h3>
            <p className="text-sm text-muted-foreground">
              {absence.staff?.fio} · {absence.staff?.specialization}
            </p>
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
              className="bg-background border border-neon rounded px-3 py-1.5 text-sm"
            >
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

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
                  className="flex items-start justify-between p-3 rounded-lg border border-neon/40 bg-background/40"
                >
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5" />
                    <div>
                      <div className="font-medium">{cand.fio}</div>
                      <div className="text-xs text-muted-foreground">
                        {cand.specialization}
                      </div>
                      {cand.warnings && cand.warnings.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {cand.warnings.map((w, i) => (
                            <div
                              key={i}
                              className="text-xs text-amber-400 flex items-center gap-1"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {w}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
