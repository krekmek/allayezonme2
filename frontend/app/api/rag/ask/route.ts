import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const EMBEDDING_MODEL = "gemini-embedding-001"; // Matryoshka, режем до 768
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
      "GEMINI_API_KEY не задан. Получи ключ на https://aistudio.google.com/app/apikey " +
        "и добавь в frontend/.env.local."
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

async function generateAnswer(
  question: string,
  hits: Hit[]
): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY не задан на сервере (.env.local)");
  }
  const contextBlocks = hits
    .map(
      (h) =>
        `[${h.source} · фрагмент ${h.chunk_index}]\n${h.content}`
    )
    .join("\n\n---\n\n");

  const system =
    "Ты — помощник школьной администрации по приказам и регламентам. " +
    "Отвечай СТРОГО на основе предоставленного контекста. " +
    "Если в контексте нет ответа — честно скажи, что информация не найдена. " +
    "Ответ давай на русском, кратко и по делу. " +
    "Указывай, из какого приказа взят факт (например, «согласно Приказу №76»).";

  const user = `Вопрос: ${question}\n\nКонтекст:\n${contextBlocks}`;

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
          { role: "user", content: user },
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
  return data.choices?.[0]?.message?.content?.trim() || "";
}

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

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

    // 1) эмбеддим вопрос
    const embedding = await embedQuery(question);

    // 2) ищем в pgvector
    const { data, error } = await supabase.rpc("match_rag_documents", {
      query_embedding: embedding,
      match_count: topK,
    });
    if (error) {
      return NextResponse.json(
        { error: `Supabase RPC error: ${error.message}` },
        { status: 500 }
      );
    }
    const hits = (data as Hit[]) || [];

    if (hits.length === 0) {
      return NextResponse.json({
        answer:
          "В базе приказов не нашлось подходящих фрагментов. " +
          "Убедитесь, что приказы загружены (python rag_service.py ingest-all ./decrees).",
        sources: [],
      });
    }

    // 3) генерируем ответ через Groq
    const answer = await generateAnswer(question, hits);

    return NextResponse.json({
      answer,
      sources: hits.map((h) => ({
        source: h.source,
        chunk_index: h.chunk_index,
        similarity: Math.round(h.similarity * 1000) / 1000,
        snippet: h.content.slice(0, 240),
      })),
    });
  } catch (e: any) {
    console.error("RAG ask error:", e);
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
