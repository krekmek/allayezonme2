import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const question: string = (body?.question || "").toString().trim();
    const topK: number = Number(body?.top_k) || 5;
    
    if (!question) {
      return NextResponse.json(
        { error: "Пустой вопрос" },
        { status: 400 }
      );
    }

    // Проксируем запрос на бэкенд
    const resp = await fetch(`${API_BASE}/api/rag/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, top_k: topK }),
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
    console.error("RAG ask error:", e);
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
