"use client";

import { VoiceTaskButton } from "./voice-task-button";
import { ModeToggle } from "./mode-toggle";

export function Header() {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between px-8 py-4 border-b border-border bg-surface backdrop-blur-md">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-foreground">School Assistant</h1>
      </div>
      <div className="flex items-center gap-3">
        <ModeToggle />
        <VoiceTaskButton />
      </div>
    </header>
  );
}
