import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type Slot = {
  id: number;
  staff_id: number;
  day_of_week: number;
  time_slot: number;
  location: string | null;
  task_description: string;
  task_type: string;
  class_name: string | null;
};

/**
 * GET /api/staff/schedule/:id
 * Возвращает полный персональный график сотрудника на неделю + его карточку.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const params = await ctx.params;
    const id = Number(params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

    const [staffRes, scheduleRes] = await Promise.all([
      supabase.from("staff").select("*").eq("id", id).limit(1),
      supabase
        .from("master_schedule")
        .select("*")
        .eq("staff_id", id)
        .order("day_of_week", { ascending: true })
        .order("time_slot", { ascending: true }),
    ]);

    if (staffRes.error) {
      return NextResponse.json(
        { error: `Supabase error: ${staffRes.error.message}` },
        { status: 500 }
      );
    }
    const staff = staffRes.data?.[0];
    if (!staff) {
      return NextResponse.json(
        { error: "Сотрудник не найден" },
        { status: 404 }
      );
    }

    const slots: Slot[] = (scheduleRes.data as Slot[]) || [];

    // Группируем по дням для удобного рендера
    const byDay: Record<number, Slot[]> = {};
    for (let d = 1; d <= 7; d++) byDay[d] = [];
    for (const s of slots) byDay[s.day_of_week].push(s);

    const weeklyLoad = staff.weekly_load ?? slots.length;
    const maxLoad = staff.max_load ?? 24;
    const loadPercent = maxLoad > 0 ? Math.min(100, Math.round((weeklyLoad / maxLoad) * 100)) : 0;

    return NextResponse.json({
      staff,
      slots,
      by_day: byDay,
      weekly_load: weeklyLoad,
      max_load: maxLoad,
      load_percent: loadPercent,
    });
  } catch (e: any) {
    console.error("Staff schedule error:", e);
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
