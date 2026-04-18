"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpenText,
  Send,
  Loader2,
  User as UserIcon,
  Sparkles,
  FileText,
  Wand2,
  MessageSquareShare,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { GenerateDocumentButton } from "@/components/generate-document-button";

type Source = {
  source: string;
  chunk_index: number;
  similarity: number;
  snippet: string;
};

type Simplification = {
  loading?: boolean;
  bullets?: string[];
  error?: string;
  broadcast?:
    | { status: "idle" }
    | { status: "sending" }
    | {
        status: "done";
        sent: number;
        failed: number;
        total: number;
        errors: { fio: string; error: string }[];
      }
    | { status: "error"; message: string };
};

type AssistantMessage = {
  role: "assistant";
  content: string;
  sources?: Source[];
  simplification?: Simplification;
};

type Message =
  | { role: "user"; content: string }
  | AssistantMessage
  | { role: "error"; content: string };

const SUGGESTIONS = [
  "Как организовано питание в школе?",
  "Какая максимальная нагрузка у 7 класса?",
  "Какой порядок перевода ученика в другую школу?",
  "Кто контролирует качество питания в столовой?",
];

export default function KnowledgePage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Привет! Я — помощник по школьным приказам №76, №110, №130. Задайте вопрос, и я найду ответ в регламентах.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  async function send(text?: string) {
    const question = (text ?? input).trim();
    if (!question || loading) return;

    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setLoading(true);

    try {
      const resp = await fetch("/api/rag/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setMessages((m) => [
          ...m,
          { role: "error", content: data?.error || "Ошибка запроса" },
        ]);
      } else {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: data.answer || "(пустой ответ)",
            sources: data.sources || [],
          },
        ]);
      }
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "error", content: e?.message || "Сетевая ошибка" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Обновить simplification для конкретного индекса сообщения
  function updateSimplification(
    idx: number,
    patch: Partial<Simplification>
  ) {
    setMessages((prev) =>
      prev.map((m, i) => {
        if (i !== idx || m.role !== "assistant") return m;
        return {
          ...m,
          simplification: { ...(m.simplification || {}), ...patch },
        };
      })
    );
  }

  async function simplifyMessage(idx: number, text: string) {
    updateSimplification(idx, {
      loading: true,
      error: undefined,
      bullets: undefined,
      broadcast: { status: "idle" },
    });
    try {
      const resp = await fetch("/api/rag/simplify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        updateSimplification(idx, {
          loading: false,
          error: data?.error || "Ошибка упрощения",
        });
      } else {
        updateSimplification(idx, {
          loading: false,
          bullets: data.bullets || [],
        });
      }
    } catch (e: any) {
      updateSimplification(idx, {
        loading: false,
        error: e?.message || "Сетевая ошибка",
      });
    }
  }

  async function broadcastMessage(idx: number, bullets: string[]) {
    const message =
      "📢 <b>Новое разъяснение от администрации:</b>\n\n" +
      bullets.map((b) => `• ${b}`).join("\n");
    updateSimplification(idx, { broadcast: { status: "sending" } });
    try {
      const resp = await fetch("/api/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, audience: "teachers" }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        updateSimplification(idx, {
          broadcast: {
            status: "error",
            message: data?.error || "Ошибка рассылки",
          },
        });
      } else {
        updateSimplification(idx, {
          broadcast: {
            status: "done",
            sent: data.sent,
            failed: data.failed,
            total: data.total,
            errors: data.errors || [],
          },
        });
      }
    } catch (e: any) {
      updateSimplification(idx, {
        broadcast: {
          status: "error",
          message: e?.message || "Сетевая ошибка",
        },
      });
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] space-y-4">
      <header className="shrink-0 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-neon flex items-center gap-3">
            <BookOpenText className="h-8 w-8 text-neon" />
            Помощник по приказам
          </h1>
          <p className="text-muted-foreground">
            Спросите по регламенту: приём, питание, режим занятий. Ответы — из
            приказов №76, №110, №130 с указанием источника.
          </p>
        </div>
        <GenerateDocumentButton />
      </header>

      <div className="flex-1 min-h-0 bg-card border border-neon rounded-md flex flex-col overflow-hidden">
        {/* История сообщений */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-5 space-y-4"
        >
          {messages.map((m, i) => (
            <MessageBubble
              key={i}
              message={m}
              onSimplify={
                m.role === "assistant"
                  ? () => simplifyMessage(i, m.content)
                  : undefined
              }
              onBroadcast={
                m.role === "assistant"
                  ? (bullets) => broadcastMessage(i, bullets)
                  : undefined
              }
            />
          ))}

          {loading && (
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/15 p-2 text-primary shadow-neon-sm">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="rounded-2xl border border-neon/40 bg-background/40 px-4 py-3 text-sm text-muted-foreground inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Ищу в приказах...
              </div>
            </div>
          )}
        </div>

        {/* Подсказки */}
        {messages.length <= 1 && !loading && (
          <div className="px-5 pb-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-xs rounded-full border border-neon/40 bg-primary/5 hover:bg-primary/10 hover:border-neon px-3 py-1.5 transition"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Ввод */}
        <div className="border-t border-neon p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Задайте вопрос по приказам... (Enter — отправить, Shift+Enter — перенос)"
              rows={2}
              className="flex-1 resize-none rounded-lg border border-neon/40 bg-background/40 px-3 py-2 text-sm outline-none focus:border-neon focus:shadow-neon-sm transition placeholder:text-muted-foreground/60"
              disabled={loading}
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-primary/15 border border-neon px-4 py-2.5 text-sm font-medium text-primary transition hover:bg-primary/25 hover:shadow-neon disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="h-4 w-4" />
              Отправить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onSimplify,
  onBroadcast,
}: {
  message: Message;
  onSimplify?: () => void;
  onBroadcast?: (bullets: string[]) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex items-start gap-3 justify-end">
        <div className="rounded-2xl border border-neon bg-primary/10 px-4 py-3 text-sm max-w-[80%] shadow-neon-sm">
          {message.content}
        </div>
        <div className="rounded-full bg-primary/15 p-2 text-primary shadow-neon-sm">
          <UserIcon className="h-4 w-4" />
        </div>
      </div>
    );
  }
  if (message.role === "error") {
    return (
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-red-500/15 p-2 text-red-300">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="rounded-2xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-300 max-w-[80%]">
          {message.content}
        </div>
      </div>
    );
  }
  // assistant
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-full bg-primary/15 p-2 text-primary shadow-neon-sm">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="flex-1 space-y-2 max-w-[85%]">
        <div className="rounded-2xl border border-neon/40 bg-background/40 px-4 py-3 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
        {message.sources && message.sources.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground flex items-center gap-1 px-1">
              <FileText className="h-3 w-3" />
              Источники:
            </div>
            {message.sources.map((s, i) => (
              <details
                key={i}
                className="rounded-lg border border-neon/30 bg-background/30 px-3 py-2 text-xs"
              >
                <summary className="cursor-pointer flex items-center justify-between gap-2">
                  <span className="text-foreground font-medium">
                    {s.source} · фрагмент {s.chunk_index}
                  </span>
                  <span className="text-primary shrink-0">
                    {(s.similarity * 100).toFixed(0)}%
                  </span>
                </summary>
                <p className="mt-2 text-muted-foreground leading-relaxed">
                  {s.snippet}
                  {s.snippet.length >= 240 ? "..." : ""}
                </p>
              </details>
            ))}
          </div>
        )}

        {/* Кнопка «Упростить для учителей» + результат + рассылка */}
        {message.sources && message.sources.length > 0 && (
          <SimplifyBlock
            simplification={message.simplification}
            onSimplify={onSimplify}
            onBroadcast={onBroadcast}
          />
        )}
      </div>
    </div>
  );
}

function SimplifyBlock({
  simplification,
  onSimplify,
  onBroadcast,
}: {
  simplification?: Simplification;
  onSimplify?: () => void;
  onBroadcast?: (bullets: string[]) => void;
}) {
  const s = simplification;
  // Ещё не запускали — показываем только кнопку
  if (!s) {
    return (
      <div className="pt-1">
        <button
          type="button"
          onClick={onSimplify}
          className="inline-flex items-center gap-1.5 rounded-md border border-neon/40 bg-primary/5 hover:bg-primary/15 hover:border-neon px-3 py-1.5 text-xs font-medium text-primary transition"
        >
          <Wand2 className="h-3.5 w-3.5" />
          Упростить для учителей
        </button>
      </div>
    );
  }

  if (s.loading) {
    return (
      <div className="rounded-lg border border-neon/40 bg-background/40 px-4 py-3 text-sm text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Упрощаю для учителей...
      </div>
    );
  }

  if (s.error) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        Ошибка: {s.error}
        <button
          type="button"
          onClick={onSimplify}
          className="ml-2 underline hover:text-red-200"
        >
          Повторить
        </button>
      </div>
    );
  }

  if (!s.bullets || s.bullets.length === 0) return null;

  const broadcast = s.broadcast;
  return (
    <div className="rounded-lg border border-neon bg-primary/5 p-4 space-y-3 shadow-neon-sm">
      <div className="text-xs uppercase tracking-wide text-primary flex items-center gap-1.5">
        <Wand2 className="h-3.5 w-3.5" />
        Для учителей
      </div>
      <ul className="space-y-1.5 text-sm">
        {s.bullets.map((b, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-primary shrink-0">•</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <button
          type="button"
          onClick={() => onBroadcast?.(s.bullets!)}
          disabled={broadcast?.status === "sending"}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 border border-neon px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/25 hover:shadow-neon disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {broadcast?.status === "sending" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MessageSquareShare className="h-3.5 w-3.5" />
          )}
          Отправить всем в ТГ
        </button>
        <button
          type="button"
          onClick={onSimplify}
          className="inline-flex items-center gap-1.5 rounded-md border border-neon/40 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-neon transition"
        >
          <Wand2 className="h-3.5 w-3.5" />
          Переформулировать
        </button>
      </div>

      {broadcast?.status === "done" && (
        <div
          className={`text-xs rounded-md px-3 py-2 border ${
            broadcast.failed === 0
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/40 bg-amber-500/10 text-amber-200"
          }`}
        >
          <div className="flex items-center gap-1.5">
            {broadcast.failed === 0 ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            Отправлено: <b>{broadcast.sent}</b> из {broadcast.total}
            {broadcast.failed > 0 && <> · ошибок: <b>{broadcast.failed}</b></>}
          </div>
          {broadcast.total === 0 && (
            <div className="mt-1 opacity-80">
              Нет учителей с привязанным Telegram. Попросите их пройти /start у
              бота.
            </div>
          )}
          {broadcast.errors.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer opacity-80">
                Детали ошибок
              </summary>
              <ul className="mt-1 space-y-0.5 opacity-80">
                {broadcast.errors.map((e, i) => (
                  <li key={i}>
                    • {e.fio}: {e.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {broadcast?.status === "error" && (
        <div className="text-xs rounded-md px-3 py-2 border border-red-500/40 bg-red-500/10 text-red-300 flex items-center gap-1.5">
          <XCircle className="h-3.5 w-3.5" />
          {broadcast.message}
        </div>
      )}
    </div>
  );
}
