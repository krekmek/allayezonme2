import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIM = 768;
const LLM_MODEL = "llama-3.3-70b-versatile";

function l2Normalize(vec: number[]): number[] {
  let sum = 0;
  for (const x of vec) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec;
  return vec.map((x) => x / norm);
}

type Hit = {
  id: number;
  source: string;
  chunk_index: number;
  content: string;
  similarity: number;
};

async function embedQuery(query: string): Promise<number[]> {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY не задан. Добавьте его в frontend/.env.local."
    );
  }
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${EMBEDDING_MODEL}:embedContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: { parts: [{ text: query }] },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: EMBEDDING_DIM,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini embeddings error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return l2Normalize(data.embedding.values as number[]);
}

async function generateDocument(
  userRequest: string,
  hits: Hit[],
  directorName: string
): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY не задан на сервере (frontend/.env.local)");
  }

  const contextBlocks =
    hits.length > 0
      ? hits
          .map(
            (h) =>
              `[${h.source} · фрагмент ${h.chunk_index} · sim=${(
                Math.round(h.similarity * 1000) / 1000
              ).toFixed(3)}]\n${h.content}`
          )
          .join("\n\n---\n\n")
      : "(В базе знаний не найдено релевантных фрагментов — составляй документ по общим нормам, явно указав в нём, что ссылок на конкретные приказы нет.)";

  const today = new Date().toLocaleDateString("ru-RU");

  const system =
    "Ты — ИИ-помощник директора школы. Твоя задача — на основе предоставленных " +
    "выдержек из приказов составить ОФИЦИАЛЬНОЕ РАСПОРЯЖЕНИЕ (приказ директора) " +
    "в строгом официально-деловом стиле.\n\n" +
    "ЖЁСТКИЕ ТРЕБОВАНИЯ:\n" +
    "• Стиль: официально-деловой, без разговорных оборотов.\n" +
    "• Структура строго по шаблону ниже (Markdown).\n" +
    "• В разделе «ОСНОВАНИЕ» обязательно сошлись на номера приказов и конкретные пункты " +
    "(например: «в соответствии с п. 3.2 Приказа №130»). Используй ТОЛЬКО те приказы, " +
    "которые есть в предоставленном контексте.\n" +
    "• Если в контексте нет подходящих ссылок — честно напиши это в «ОСНОВАНИИ».\n" +
    "• Не выдумывай номера приказов и пункты, которых нет в контексте.\n" +
    "• Не добавляй реквизиты/даты за пределами шаблона.\n\n" +
    "ШАБЛОН ОТВЕТА (верни ТОЛЬКО этот Markdown, без пояснений):\n\n" +
    "# ПРИКАЗ\n" +
    `от ${today} № __\n\n` +
    "## <Краткий заголовок распоряжения>\n\n" +
    "**ОСНОВАНИЕ:** <перечисли ссылки на конкретные пункты приказов из контекста>\n\n" +
    "**ПРИКАЗЫВАЮ:**\n\n" +
    "1. <Первый пункт распоряжения>\n" +
    "2. <Второй пункт при необходимости>\n" +
    "3. Контроль за исполнением настоящего приказа оставляю за собой.\n\n" +
    `Директор школы _____________ / ${directorName}`;

  const userMsg =
    `ЗАПРОС ДИРЕКТОРА:\n${userRequest.trim()}\n\n` +
    `КОНТЕКСТ ИЗ БАЗЫ ЗНАНИЙ (выдержки из приказов):\n${contextBlocks}`;

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
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        temperature: 0.2,
      }),
    }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Groq error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

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

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

    // 1) эмбеддинг запроса
    const embedding = await embedQuery(userRequest);

    // 2) поиск по rag_documents
    const { data, error } = await supabase.rpc("match_rag_documents", {
      query_embedding: embedding,
      match_count: matchCount,
    });
    if (error) {
      return NextResponse.json(
        { error: `Supabase RPC error: ${error.message}` },
        { status: 500 }
      );
    }
    const hits: Hit[] = (data as Hit[]) || [];

    // 3) генерация документа
    const document = await generateDocument(userRequest, hits, directorName);

    // 4) извлекаем заголовок из первой "## ..." строки
    let title = "";
    for (const line of document.split("\n")) {
      const s = line.trim();
      if (s.startsWith("## ")) {
        title = s.slice(3).trim();
        break;
      }
    }
    if (!title) title = userRequest.slice(0, 80);

    const usedSources: string[] = [];
    for (const h of hits) {
      if (h.source && !usedSources.includes(h.source)) usedSources.push(h.source);
    }

    return NextResponse.json({
      document,
      title,
      references: hits.map((h) => ({
        source: h.source,
        chunk_index: h.chunk_index,
        similarity: Math.round(h.similarity * 1000) / 1000,
        snippet: h.content.slice(0, 240),
      })),
      used_sources: usedSources,
      request: userRequest,
    });
  } catch (e: any) {
    console.error("Generate document error:", e);
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
