import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import { VoiceTaskButton } from "@/components/voice-task-button";
import "./globals.css";

export const metadata: Metadata = {
  title: "School Assistant",
  description: "Панель управления школьным AI-ассистентом",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className="dark">
      <body>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 p-8 overflow-x-hidden">{children}</main>
        </div>
        <VoiceTaskButton />
      </body>
    </html>
  );
}
