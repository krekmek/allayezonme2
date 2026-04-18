"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  MessageSquare,
  User,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Zap,
  RefreshCw,
} from "lucide-react";

type TelegramMessage = {
  id: number;
  message_id: number;
  chat_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  raw_text: string;
  parsed_entities: {
    type: string;
    summary: string;
    details: Record<string, any>;
  } | null;
  intent: string | null;
  confidence: number;
  created_at: string;
  staff: string | null;
};

const INTENT_COLORS: Record<string, string> = {
  incident: "bg-red-500/10 border-red-500/30 text-red-400",
  task: "bg-blue-500/10 border-blue-500/30 text-blue-400",
  substitution: "bg-amber-500/10 border-amber-500/30 text-amber-400",
  unknown: "bg-gray-500/10 border-gray-500/30 text-gray-400",
};

const INTENT_LABELS: Record<string, string> = {
  incident: "🚨 Инцидент",
  task: "📋 Задача",
  substitution: "🔄 Замена",
  unknown: "❓ Неизвестно",
};

export function NlpLiveFeed() {
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMessages = async () => {
    try {
      const res = await fetch("/api/nlp/feed");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setMessages(data);
      setError(null);
    } catch (e) {
      setError("Ошибка загрузки ленты");
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchMessages();
  };

  useEffect(() => {
    fetchMessages();
    // Poll every 5 seconds for real-time updates
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-card border border-border rounded-md p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-primary/10 border border-primary/30">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Центр обработки данных</h3>
            <p className="text-xs text-muted-foreground">NLP-анализ в реальном времени</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="p-2 rounded-md hover:bg-card/50 text-muted-foreground hover:text-foreground transition"
          title="Обновить"
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && messages.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
          Загрузка...
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 py-4 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      ) : messages.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
          Сообщений пока нет
        </div>
      ) : (
        <div className="space-y-3 max-h-[500px] overflow-y-auto">
          {messages.map((msg) => (
            <MessageCard key={msg.id} message={msg} />
          ))}
        </div>
      )}
    </div>
  );
}

function MessageCard({ message }: { message: TelegramMessage }) {
  const entities = message.parsed_entities;
  const details = entities?.details || {};
  const intentColor = INTENT_COLORS[message.intent || "unknown"] || INTENT_COLORS.unknown;
  const intentLabel = INTENT_LABELS[message.intent || "unknown"] || INTENT_LABELS.unknown;

  return (
    <div className="border border-border rounded-md p-3 hover:bg-card/50 transition space-y-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="p-1.5 rounded-full bg-background border border-border shrink-0">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-foreground truncate">
                {message.staff || message.first_name || message.username || "Аноним"}
              </span>
              {message.staff && (
                <span className="text-xs text-muted-foreground">@{message.username || "no tg"}</span>
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {new Date(message.created_at).toLocaleTimeString("ru-RU", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${intentColor} shrink-0`}>
          {intentLabel}
        </span>
      </div>

      {/* Raw text */}
      <div className="text-sm text-muted-foreground bg-background/50 rounded p-2 border border-border/50">
        <MessageSquare className="h-3.5 w-3.5 inline mr-1.5 text-muted-foreground/50" />
        {message.raw_text}
      </div>

      {/* Parsed entities */}
      {entities && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <Zap className="h-3.5 w-3.5" />
            Распознанные сущности
          </div>
          <div className="bg-primary/5 rounded-md p-2 border border-primary/20 space-y-1">
            {entities.summary && (
              <div className="text-xs text-foreground">
                <span className="text-muted-foreground">Суть:</span> {entities.summary}
              </div>
            )}
            {Object.keys(details).length > 0 && (
              <div className="space-y-0.5">
                {Object.entries(details).map(([key, value]) => (
                  <div key={key} className="text-xs flex items-start gap-2">
                    <span className="text-muted-foreground shrink-0 capitalize">{key}:</span>
                    <span className="text-foreground">{String(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confidence */}
      {message.confidence > 0 && (
        <div className="flex items-center gap-1.5 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span className="text-muted-foreground">Уверенность:</span>
          <span className="font-medium text-foreground">{(message.confidence * 100).toFixed(0)}%</span>
        </div>
      )}
    </div>
  );
}
