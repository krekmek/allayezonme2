import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

async function sendTelegram(
  chatId: number,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const resp = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    }
  );
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.ok) {
    return { ok: false, error: data?.description || `HTTP ${resp.status}` };
  }
  return { ok: true };
}

export async function POST(req: NextRequest) {
  try {
    if (!TELEGRAM_BOT_TOKEN) {
      return NextResponse.json(
        {
          error:
            "TELEGRAM_BOT_TOKEN не задан в frontend/.env.local. " +
            "Скопируй его из backend/.env.",
        },
        { status: 500 }
      );
    }
    const body = await req.json();
    const message: string = (body?.message || "").toString().trim();
    // Целевая аудитория: "teachers" (по умолчанию) или "all"
    const audience: string = body?.audience || "teachers";
    if (!message) {
      return NextResponse.json(
        { error: "Пустое сообщение" },
        { status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

    let query = supabase
      .from("staff")
      .select("id, fio, role, telegram_id")
      .not("telegram_id", "is", null);
    if (audience === "teachers") {
      query = query.eq("role", "teacher");
    }

    const { data: recipients, error } = await query;
    if (error) {
      return NextResponse.json(
        { error: `Supabase: ${error.message}` },
        { status: 500 }
      );
    }
    if (!recipients || recipients.length === 0) {
      return NextResponse.json({
        sent: 0,
        failed: 0,
        total: 0,
        errors: [],
        note: "Нет получателей с telegram_id",
      });
    }

    // Рассылаем последовательно с маленькой задержкой, чтобы не упереться в rate limit (30 msg/sec).
    const errors: { fio: string; error: string }[] = [];
    let sent = 0;
    for (const r of recipients) {
      const res = await sendTelegram(r.telegram_id as number, message);
      if (res.ok) {
        sent += 1;
      } else {
        errors.push({ fio: r.fio, error: res.error || "unknown" });
      }
      // ~40ms между сообщениями => ~25 msg/sec
      await new Promise((res) => setTimeout(res, 40));
    }

    return NextResponse.json({
      sent,
      failed: errors.length,
      total: recipients.length,
      errors,
    });
  } catch (e: any) {
    console.error("Broadcast error:", e);
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
