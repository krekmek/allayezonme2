"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  BookOpenText,
  GraduationCap,
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
  { label: "Инциденты", href: "/incidents", icon: AlertTriangle },
  { label: "Расписание", href: "/schedule", icon: CalendarDays },
  { label: "База знаний", href: "/knowledge", icon: BookOpenText },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "sticky top-0 h-screen w-64 shrink-0",
        "flex flex-col gap-6 px-4 py-6",
        "border-r border-neon bg-surface"
      )}
    >
      <div className="flex items-center gap-3 px-2">
        <div className="grid place-items-center h-10 w-10 rounded-xl bg-primary/15 text-primary shadow-neon animate-pulse-neon">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm uppercase tracking-widest text-muted-foreground">
            School AI
          </div>
          <div className="font-semibold text-glow">Панель управления</div>
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
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition",
                "text-muted-foreground hover:text-foreground hover:bg-primary/5",
                active &&
                  "bg-primary/10 text-foreground shadow-neon-sm border border-neon"
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 transition",
                  active
                    ? "text-primary drop-shadow-[0_0_6px_rgba(168,85,247,0.8)]"
                    : "text-muted-foreground group-hover:text-primary"
                )}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-xl border border-neon bg-primary/5 p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-1">Подсказка</p>
        <p>Начните с Мониторинга, чтобы оценить состояние школы.</p>
      </div>
    </aside>
  );
}
