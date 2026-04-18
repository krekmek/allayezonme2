"use client";

import { useEffect, useRef, useState } from "react";
import {
  Mic,
  Square,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";

type Task = {
  id: number;
  description: string;
  assignee: string | null;
  due_date: string | null;
};

type Status =
  | { kind: "idle" }
  | { kind: "recording"; transcript: string; interim: string }
  | { kind: "processing"; transcript: string }
  | { kind: "success"; transcript: string; tasks: Task[] }
  | { kind: "error"; message: string; reason?: string; transcript?: string };

// Минимальные типы для Web Speech API
type SpeechRecognitionResultList = {
  length: number;
  [idx: number]: {
    isFinal: boolean;
    [idx: number]: { transcript: string };
  };
};

type SpeechRecognitionEvent = {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

type SpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

export function VoiceTaskButton() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finalTranscriptRef = useRef<string>("");
  const stoppedManuallyRef = useRef<boolean>(false);

  // Авто-скрытие уведомлений
  useEffect(() => {
    if (status.kind === "success" || status.kind === "error") {
      const t = setTimeout(
        () => setStatus({ kind: "idle" }),
        status.kind === "success" ? 15000 : 8000
      );
      return () => clearTimeout(t);
    }
  }, [status]);

  function startRecording() {
    const SR =
      typeof window !== "undefined"
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : undefined;

    if (!SR) {
      setStatus({
        kind: "error",
        message:
          "Ваш браузер не поддерживает распознавание речи. Используйте Chrome или Edge.",
      });
      return;
    }

    finalTranscriptRef.current = "";
    stoppedManuallyRef.current = false;

    const recognition = new SR();
    recognition.lang = "ru-RU";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          finalTranscriptRef.current += transcript + " ";
        } else {
          interim += transcript;
        }
      }
      setStatus({
        kind: "recording",
        transcript: finalTranscriptRef.current.trim(),
        interim: interim.trim(),
      });
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        setStatus({
          kind: "error",
          message: "Доступ к микрофону запрещён. Разрешите его в браузере.",
        });
      } else if (event.error === "no-speech") {
        // Игнорируем — просто пользователь молчит
      } else {
        setStatus({ kind: "error", message: `Ошибка: ${event.error}` });
      }
    };

    recognition.onend = () => {
      // Если не остановили вручную — перезапускаем (continuous иногда сам останавливается)
      if (!stoppedManuallyRef.current) {
        try {
          recognition.start();
        } catch {
          // ignore
        }
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setStatus({ kind: "recording", transcript: "", interim: "" });
    } catch (e: any) {
      setStatus({
        kind: "error",
        message: `Не удалось запустить запись: ${e?.message || e}`,
      });
    }
  }

  async function stopRecording() {
    stoppedManuallyRef.current = true;
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    const transcript = finalTranscriptRef.current.trim();

    if (!transcript) {
      setStatus({
        kind: "error",
        message: "Не распознано ни слова. Попробуйте ещё раз.",
      });
      return;
    }

    setStatus({ kind: "processing", transcript });

    try {
      const resp = await fetch("http://localhost:8001/api/process-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcript }),
      });
      const data = await resp.json();

      // Intent Guard отклонил задачу
      if (!resp.ok || data?.valid === false) {
        const baseMsg =
          "ИИ не распознал задачу. Пожалуйста, уточните распоряжение";
        const details = data?.error || data?.message;
        setStatus({
          kind: "error",
          message: details ? `${baseMsg}: ${details}` : baseMsg,
          reason: data?.reason,
          transcript,
        });
        return;
      }

      setStatus({
        kind: "success",
        transcript: data.transcript || transcript,
        tasks: data.tasks || [],
      });
    } catch (e: any) {
      setStatus({
        kind: "error",
        message: e?.message || "Сетевая ошибка",
      });
    }
  }

  // Очистка при размонтировании
  useEffect(() => {
    return () => {
      stoppedManuallyRef.current = true;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const isRecording = status.kind === "recording";
  const isProcessing = status.kind === "processing";

  return (
    <>
      {/* Кнопка микрофона */}
      <button
        type="button"
        onClick={isRecording ? stopRecording : startRecording}
        disabled={isProcessing}
        aria-label={
          isRecording ? "Остановить запись" : "Записать задачу голосом"
        }
        className={`relative h-11 w-11 rounded-md border shadow-md flex items-center justify-center transition
          ${
            isRecording
              ? "bg-red-500/20 border-red-500 text-red-200 animate-pulse"
              : isProcessing
              ? "bg-card border-border text-foreground opacity-60"
              : "bg-card border-border text-foreground hover:bg-card/50 hover:scale-105"
          }`}
      >
        {isProcessing && (
          <span className="absolute inset-0 rounded-md border-2 border-foreground animate-ping" />
        )}
        {isProcessing ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : isRecording ? (
          <Square className="h-5 w-5 fill-current" />
        ) : (
          <Mic className="h-6 w-6" />
        )}
      </button>

      {/* Live-транскрипт во время записи */}
      {isRecording && (
        <div className="fixed top-20 right-8 z-40 min-w-[400px] max-w-lg rounded-md border border-border bg-card/95 backdrop-blur-md px-4 py-3 shadow-md animate-in slide-in-from-top-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-medium text-foreground">
              Слушаю...
            </span>
            <span className="text-xs text-muted-foreground ml-auto">
              нажмите ещё раз — отправить
            </span>
          </div>
          <div className="text-sm text-foreground min-h-[1.5em]">
            {status.transcript ||
              status.interim ||
              (
                <span className="text-muted-foreground italic">
                  Говорите...
                </span>
              )}
            {status.interim && (
              <span className="text-muted-foreground italic ml-1">
                {status.interim}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Индикатор обработки */}
      {isProcessing && (
        <div className="fixed top-20 right-8 z-40 min-w-[360px] max-w-md rounded-md border border-border bg-card/95 backdrop-blur-md px-4 py-3 shadow-md animate-in slide-in-from-top-4">
          <div className="flex items-center gap-2 mb-2 text-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm font-medium">Создаю задачи...</span>
          </div>
          <div className="text-xs text-muted-foreground italic bg-card/50 rounded px-2 py-1.5 border border-border">
            🎤 {status.transcript}
          </div>
        </div>
      )}

      {/* Уведомление об успехе */}
      {status.kind === "success" && (
        <Toast kind="success">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="font-medium text-foreground">
                {status.tasks.length > 0
                  ? getSuccessMessage(status.tasks)
                  : "Распознано, но задач не найдено"}
              </div>

              {status.transcript && (
                <div className="text-xs text-muted-foreground italic bg-card/50 rounded px-2 py-1.5 border border-border">
                  <span className="not-italic font-medium text-foreground">
                    🎤 Текст:{" "}
                  </span>
                  {status.transcript}
                </div>
              )}

              {status.tasks.length > 0 && (
                <div className="text-sm text-foreground space-y-1">
                  {status.tasks.map((task, idx) => (
                    <div key={task.id} className="flex items-start gap-2">
                      <span className="text-muted-foreground">
                        {idx + 1}.
                      </span>
                      <span>{task.description}</span>
                      {task.assignee && (
                        <span className="text-xs text-muted-foreground">
                          → {task.assignee}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
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

      {/* Ошибка */}
      {status.kind === "error" && (
        <Toast kind="error">
          <div className="flex items-start gap-3">
            <XCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="text-sm text-foreground font-medium">
                {status.message}
              </div>
              {status.transcript && (
                <div className="text-xs text-muted-foreground italic bg-card/50 rounded px-2 py-1.5 border border-red-500/30">
                  <span className="not-italic font-medium text-foreground">
                    🎤 Вы сказали:{" "}
                  </span>
                  {status.transcript}
                </div>
              )}
              {status.reason === "missing_details" && (
                <div className="text-xs text-muted-foreground">
                  Попробуйте уточнить: кто, что и когда должен сделать.
                </div>
              )}
            </div>
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
  const bg =
    kind === "success"
      ? "bg-card/95"
      : "bg-red-500/10 dark:bg-red-500/15";
  return (
    <div
      className={`fixed top-20 right-8 z-40 min-w-[360px] max-w-md rounded-md border ${border} ${bg} backdrop-blur-md px-4 py-3 shadow-md animate-in slide-in-from-top-4`}
    >
      {children}
    </div>
  );
}

function getSuccessMessage(tasks: Task[]): string {
  const assignees = tasks
    .map((t) => t.assignee)
    .filter((a): a is string => a !== null);

  if (assignees.length === 0) {
    return tasks.length === 1 ? "Задача создана" : `Создано задач: ${tasks.length}`;
  }
  if (assignees.length === 1) {
    return `Задача для ${assignees[0]} создана`;
  }
  if (assignees.length === 2) {
    return `Задачи для ${assignees[0]} и ${assignees[1]} созданы`;
  }
  const last = assignees[assignees.length - 1];
  const others = assignees.slice(0, -1).join(", ");
  return `Задачи для ${others} и ${last} созданы`;
}
