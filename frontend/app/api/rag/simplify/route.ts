import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const LLM_MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `Ты — помощник директора школы. Твоя задача — упростить сложный пункт приказа так, чтобы он был понятен каждому учителю.

Требования к ответу:
- РОВНО 3 буллит-поинта, каждый на новой строке
- Каждый пункт начинается с "• " (bullet + пробел)
- Каждый пункт — одно короткое предложение (максимум 15 слов)
- Простой разговорный русский, без канцеляризмов и юридических оборотов
- Конкретные действия, сроки и кому что делать
- БЕЗ вступлений, БЕЗ заключений, БЕЗ markdown — только три строки с буллитами`;

export async function POST(req: NextRequest) {
  try {
    if (!GROQ_API_KEY) {
      return NextResponse.json(
        { error: "GROQ_API_KEY не задан на сервере" },
        { status: 500 }
      );
    }
    const body = await req.json();
    const text: string = (body?.text || "").toString().trim();
    if (!text) {
      return NextResponse.json({ error: "Пустой текст" }, { status: 400 });
    }

    const resp = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: text },
          ],
          temperature: 0.3,
        }),
      }
    );
    if (!resp.ok) {
      const t = await resp.text();
      return NextResponse.json(
        { error: `Groq error ${resp.status}: ${t}` },
        { status: 500 }
      );
    }
    const data = await resp.json();
    const raw: string = data.choices?.[0]?.message?.content?.trim() || "";

    // Парсим буллиты
    const bullets = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => l.replace(/^[•\-\*·]\s*/, "").trim())
      .filter((l) => l.length > 0)
      .slice(0, 3);

    return NextResponse.json({ bullets, raw });
  } catch (e: any) {
    console.error("Simplify error:", e);
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
