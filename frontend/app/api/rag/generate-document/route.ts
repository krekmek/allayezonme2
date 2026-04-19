import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userRequest: string = (body?.request || "").toString().trim();
    const directorName: string =
      (body?.director_name || "").toString().trim() || "И.О. Директора";
    const matchCount: number = Number(body?.match_count) || 6;

    if (!userRequest) {
      return NextResponse.json(
        { error: "Пустой запрос. Опишите суть распоряжения." },
        { status: 400 }
      );
    }

    // Проксируем запрос на бэкенд
    const resp = await fetch(`${API_BASE}/api/generate-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: userRequest,
        director_name: directorName,
        match_count: matchCount,
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      return NextResponse.json(
        { error: data?.error || "Ошибка бэкенда" },
        { status: resp.status }
      );
    }

    return NextResponse.json(data);
  } catch (e: any) {
    console.error("Generate document error:", e);
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
