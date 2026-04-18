"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, GraduationCap, CalendarDays, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";

type ClassInfo = {
  name: string;
  studentCount?: number;
  homeroomTeacher?: string;
};

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadClasses() {
      // Получаем уникальные классы из расписания
      const { data: scheduleData } = await supabase
        .from("schedules")
        .select("class_name")
        .not("class_name", "is", null)
        .order("class_name");

      const uniqueClasses = Array.from(
        new Set(scheduleData?.map((s) => s.class_name))
      ).sort();

      // Заглушка данных - в реальности нужно брать из таблицы classes
      const classData = uniqueClasses.map((className) => ({
        name: className,
        studentCount: Math.floor(Math.random() * 10) + 20, // 20-30 учеников
        homeroomTeacher: "Иванов И.И.", // Заглушка
      }));

      setClasses(classData);
      setLoading(false);
    }
    loadClasses();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <GraduationCap className="h-6 w-6" />
            Классы
          </h1>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Загрузка...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {classes.map((cls) => (
              <Link
                key={cls.name}
                href={`/classes/${encodeURIComponent(cls.name)}`}
                className="bg-card border border-border rounded-lg p-6 hover:border-primary/60 transition group"
              >
                <div className="flex items-start justify-between mb-4">
                  <h2 className="text-xl font-bold text-foreground">{cls.name}</h2>
                  <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition" />
                </div>
                
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="h-4 w-4" />
                    <span>{cls.studentCount} учеников</span>
                  </div>
                  
                  {cls.homeroomTeacher && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <GraduationCap className="h-4 w-4" />
                      <span>{cls.homeroomTeacher}</span>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="h-4 w-4" />
                    <span>Расписание</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
