"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Activity, AlertTriangle, Users, UtensilsCrossed, Clock } from "lucide-react";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type GroupEvent = {
  id: number;
  raw_text: string;
  detected_intent: string;
  author_name: string | null;
  author_username: string | null;
  timestamp: string;
  is_critical: boolean;
};

const intentConfig = {
  absence: {
    label: "Отсутствие",
    icon: Clock,
    color: "text-yellow-500",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/20",
    tag: "#Отсутствие",
  },
  substitution: {
    label: "Замена",
    icon: Users,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
    tag: "#Замена",
  },
  incident: {
    label: "Инцидент",
    icon: AlertTriangle,
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
    tag: "#Инцидент",
  },
  canteen_report: {
    label: "Столовая",
    icon: UtensilsCrossed,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/20",
    tag: "#Столовая",
  },
  task: {
    label: "Задача",
    icon: Activity,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/20",
    tag: "#Задача",
  },
  other: {
    label: "Другое",
    icon: Activity,
    color: "text-gray-500",
    bgColor: "bg-gray-500/10",
    borderColor: "border-gray-500/20",
    tag: "#Другое",
  },
};

export function GroupEventsStream() {
  const [events, setEvents] = useState<GroupEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadEvents() {
      const { data, error } = await supabase
        .from("group_events")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(20);

      if (error) {
        console.error("Error loading group events:", error);
      } else {
        setEvents(data as GroupEvent[]);
      }
      setLoading(false);
    }

    loadEvents();

    // Real-time subscription
    const channel = supabase
      .channel("group_events_changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_events",
        },
        (payload) => {
          setEvents((prev) => [payload.new as GroupEvent, ...prev].slice(0, 20));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-5 w-5 text-neon" />
          <h2 className="text-xl font-semibold text-foreground">
            Прямой эфир школы
          </h2>
        </div>
        <p className="text-muted-foreground">Загрузка...</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="bg-card border border-border rounded-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-5 w-5 text-neon" />
          <h2 className="text-xl font-semibold text-foreground">
            Прямой эфир школы
          </h2>
        </div>
        <p className="text-muted-foreground">Нет событий</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-md p-6">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="h-5 w-5 text-neon" />
        <h2 className="text-xl font-semibold text-foreground">
          Прямой эфир школы
        </h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {events.length} событий
        </span>
      </div>

      <div className="space-y-3 max-h-[600px] overflow-y-auto">
        {events.map((event) => {
          const config =
            intentConfig[event.detected_intent as keyof typeof intentConfig] ||
            intentConfig.other;
          const Icon = config.icon;
          const time = new Date(event.timestamp).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          });

          return (
            <div
              key={event.id}
              className={`p-4 rounded-md border ${config.bgColor} ${config.borderColor} ${
                event.is_critical ? "ring-2 ring-red-500" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`p-2 rounded-full ${config.bgColor} ${config.color}`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium ${config.color}`}>
                      {config.tag}
                    </span>
                    {event.is_critical && (
                      <span className="text-xs font-medium text-red-500">
                        🚨 КРИТИЧЕСКО
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {time}
                    </span>
                  </div>
                  <p className="text-sm text-foreground mb-1">
                    {event.raw_text}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {event.author_name || event.author_username || "Неизвестный"}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
