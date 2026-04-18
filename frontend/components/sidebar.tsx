"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  BookOpenText,
  GraduationCap,
  Utensils,
  ListTodo,
  Users,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const NAV: NavItem[] = [
  { label: "Мониторинг", href: "/", icon: Activity },
  { label: "Задачи", href: "/tasks", icon: ListTodo },
  { label: "Инциденты", href: "/incidents", icon: AlertTriangle },
  { label: "Столовая", href: "/canteen", icon: Utensils },
  { label: "Расписание", href: "/schedule", icon: CalendarDays },
  { label: "Коллектив", href: "/staff", icon: Users },
  { label: "Общий график", href: "/staff-schedule", icon: CalendarClock },
  { label: "База знаний", href: "/knowledge", icon: BookOpenText },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "sticky top-0 h-screen w-64 shrink-0",
        "flex flex-col gap-6 px-4 py-6",
        "border-r border-border bg-surface-glass backdrop-blur-xl"
      )}
    >
      <div className="flex items-center gap-3 px-2">
        <div className="grid place-items-center h-10 w-10 rounded-md bg-card border border-border text-foreground">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm uppercase tracking-widest text-muted-foreground">
            Aqbobek Artificial Assistant
          </div>
          <div className="font-semibold text-foreground">Панель управления</div>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname?.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition",
                "text-muted-foreground hover:text-foreground hover:bg-card border border-transparent",
                active &&
                  "bg-card text-foreground border-border"
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 transition",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground group-hover:text-foreground"
                )}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-md border border-border bg-card p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-1">Подсказка</p>
        <p>Начните с Мониторинга, чтобы оценить состояние школы.</p>
      </div>
    </aside>
  );
}
