"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { VoiceTaskButton } from "./voice-task-button";
import { ModeToggle } from "./mode-toggle";

const navItems = [
  { href: "/", label: "Дашборд" },
  { href: "/schedule", label: "Расписание" },
  { href: "/classes", label: "Классы" },
  { href: "/settings", label: "Настройки" },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between px-8 py-4 border-b border-border bg-surface backdrop-blur-md">
      <div className="flex items-center gap-6">
        <h1 className="text-lg font-semibold text-foreground">School Assistant</h1>
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-2 rounded-md text-sm font-medium transition ${
                pathname === item.href
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/50"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <ModeToggle />
        <VoiceTaskButton />
      </div>
    </header>
  );
}
