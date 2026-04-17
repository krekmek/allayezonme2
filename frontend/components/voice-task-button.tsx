"use client";

import { useEffect, useRef, useState } from "react";
import {
  Mic,
  Square,
  Loader2,
  CheckCircle2,
  XCircle,
  User as UserIcon,
  CalendarDays,
} from "lucide-react";

type Status =
  | { kind: "idle" }
  | { kind: "recording"; elapsedMs: number }
  | { kind: "processing" }
  | {
      kind: "success";
      task: {
        id: number;
        description: string;
        assignee: string | null;
        due_date: string | null;
        title?: string;
      };
    }
  | { kind: "error"; message: string };

export function VoiceTaskButton() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Авто-скрытие уведомлений
  useEffect(() => {
    if (status.kind === "success" || status.kind === "error") {
      const t = setTimeout(
        () => setStatus({ kind: "idle" }),
        status.kind === "success" ? 8000 : 6000
      );
      return () => clearTimeout(t);
    }
  }, [status]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      // Выбираем поддерживаемый mime-type
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ];
      const mimeType =
        candidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
      const rec = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRef.current = rec;

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = handleStop;
      rec.start();

      startedAtRef.current = Date.now();
      setStatus({ kind: "recording", elapsedMs: 0 });
      timerRef.current = setInterval(() => {
        setStatus({
          kind: "recording",
          elapsedMs: Date.now() - startedAtRef.current,
        });
      }, 200);
    } catch (e: any) {
      setStatus({
        kind: "error",
        message: "Нет доступа к микрофону: " + (e?.message || e),
      });
    }
  }

  function stopRecording() {
    const rec = mediaRef.current;
    if (!rec) return;
    if (rec.state !== "inactive") rec.stop();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  async function handleStop() {
    setStatus({ kind: "processing" });
    const blob = new Blob(chunksRef.current, {
      type: mediaRef.current?.mimeType || "audio/webm",
    });
    if (blob.size < 1000) {
      setStatus({
        kind: "error",
        message: "Слишком короткая запись — попробуйте ещё раз",
      });
      return;
    }

    const ext = (mediaRef.current?.mimeType || "audio/webm").includes("ogg")
      ? "ogg"
      : (mediaRef.current?.mimeType || "").includes("mp4")
      ? "m4a"
      : "webm";

    const form = new FormData();
    form.append("audio", blob, `voice.${ext}`);

    try {
      const resp = await fetch("/api/voice/task", {
        method: "POST",
        body: form,
      });
      const data = await resp.json();
      if (!resp.ok) {
        setStatus({ kind: "error", message: data?.error || "Ошибка сервера" });
        return;
      }
      setStatus({ kind: "success", task: data.task });
    } catch (e: any) {
      setStatus({ kind: "error", message: e?.message || "Сетевая ошибка" });
    }
  }

  const isRecording = status.kind === "recording";
  const isProcessing = status.kind === "processing";

  return (
    <>
      {/* FAB */}
      <button
        type="button"
        onClick={isRecording ? stopRecording : startRecording}
        disabled={isProcessing}
        aria-label={isRecording ? "Остановить запись" : "Записать задачу голосом"}
        className={`fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full border shadow-neon flex items-center justify-center transition
          ${
            isRecording
              ? "bg-red-500/20 border-red-500 text-red-200 animate-pulse"
              : isProcessing
              ? "bg-primary/15 border-neon text-primary opacity-60"
              : "bg-primary/15 border-neon text-primary hover:bg-primary/25 hover:scale-105"
          }`}
      >
        {isProcessing ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : isRecording ? (
          <Square className="h-5 w-5 fill-current" />
        ) : (
          <Mic className="h-6 w-6" />
        )}
      </button>

      {/* Индикатор записи */}
      {isRecording && (
        <div className="fixed bottom-24 right-6 z-40 rounded-lg border border-red-500 bg-background/90 backdrop-blur-sm px-4 py-2 text-sm text-red-200 shadow-neon-sm flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          Запись {formatElapsed(status.elapsedMs)}
          <span className="text-xs text-muted-foreground ml-2">
            нажмите ещё раз — остановить
          </span>
        </div>
      )}

      {/* Уведомления */}
      {status.kind === "success" && (
        <Toast kind="success">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-300 mt-0.5 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="font-medium">
                {status.task.assignee
                  ? `Задача для ${status.task.assignee} создана`
                  : "Задача создана"}
              </div>
              {status.task.title && (
                <div className="text-sm text-foreground/90">
                  {status.task.title}
                </div>
              )}
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {status.task.assignee && (
                  <span className="inline-flex items-center gap-1">
                    <UserIcon className="h-3 w-3" />
                    {status.task.assignee}
                  </span>
                )}
                {status.task.due_date && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    до {status.task.due_date}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStatus({ kind: "idle" })}
              className="text-muted-foreground hover:text-foreground text-xs shrink-0"
              aria-label="Закрыть"
            >
              ✕
            </button>
          </div>
        </Toast>
      )}

      {status.kind === "error" && (
        <Toast kind="error">
          <div className="flex items-start gap-2">
            <XCircle className="h-5 w-5 text-red-300 mt-0.5 shrink-0" />
            <div className="flex-1 text-sm">{status.message}</div>
            <button
              type="button"
              onClick={() => setStatus({ kind: "idle" })}
              className="text-muted-foreground hover:text-foreground text-xs shrink-0"
            >
              ✕
            </button>
          </div>
        </Toast>
      )}

      {status.kind === "processing" && (
        <div className="fixed bottom-24 right-6 z-40 rounded-lg border border-neon bg-background/90 backdrop-blur-sm px-4 py-2 text-sm text-primary shadow-neon-sm flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Распознаю и извлекаю задачу...
        </div>
      )}
    </>
  );
}

function Toast({
  kind,
  children,
}: {
  kind: "success" | "error";
  children: React.ReactNode;
}) {
  const border = kind === "success" ? "border-emerald-500" : "border-red-500";
  return (
    <div
      className={`fixed bottom-24 right-6 z-40 min-w-[320px] max-w-sm rounded-xl border ${border} bg-background/95 backdrop-blur-md px-4 py-3 shadow-neon animate-in slide-in-from-bottom-4`}
    >
      {children}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}
