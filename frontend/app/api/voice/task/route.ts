import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";

const WHISPER_MODEL = "whisper-large-v3";
const LLM_MODEL = "llama-3.3-70b-versatile";

const TASK_EXTRACT_PROMPT = `Ты — ассистент директора школы. На вход получаешь транскрипт голосового поручения.
Извлеки из него задачу в строгом JSON:

{
  "title": "краткая формулировка поручения (до 120 символов, с большой буквы, без точки в конце)",
  "assignee": "кому поручено (ФИО, имя или роль, если есть; иначе null)",
  "due_date": "срок в формате YYYY-MM-DD (если вычисляется из относительных выражений) или null",
  "description": "полный текст поручения, приведённый к литературному виду"
}

Важно:
- Отвечай ТОЛЬКО JSON, без пояснений и без markdown-обёрток.
- Если исходник не похож на поручение — всё равно заполни title и description, assignee/due_date поставь null.`;

type ExtractedTask = {
  title: string;
  assignee: string | null;
  due_date: string | null;
  description: string;
};

async function transcribeAudio(blob: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("model", WHISPER_MODEL);
  form.append("language", "ru");
  form.append("response_format", "text");

  const resp = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body: form,
    }
  );
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Whisper ${resp.status}: ${t}`);
  }
  // При response_format=text возвращается plain-text
  return (await resp.text()).trim();
}

async function extractTask(transcript: string): Promise<ExtractedTask> {
  const today = new Date().toISOString().slice(0, 10);
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
          {
            role: "system",
            content:
              TASK_EXTRACT_PROMPT +
              `\n\nСегодня: ${today}. Используй эту дату для вычисления due_date из слов «завтра», «в пятницу», «через неделю» и т.п.`,
          },
          { role: "user", content: transcript },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    }
  );
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`LLM ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw);
  return {
    title: String(parsed.title || "Новая задача").slice(0, 200),
    assignee: parsed.assignee ? String(parsed.assignee) : null,
    due_date:
      parsed.due_date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.due_date)
        ? parsed.due_date
        : null,
    description: String(parsed.description || transcript),
  };
}

export async function POST(req: NextRequest) {
  try {
    if (!GROQ_API_KEY) {
      return NextResponse.json(
        { error: "GROQ_API_KEY не задан на сервере" },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const file = form.get("audio") as File | null;
    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "Отсутствует поле audio" },
        { status: 400 }
      );
    }
    const filename = file.name && file.name.length > 0 ? file.name : "voice.webm";

    // 1) Транскрипция
    const transcript = await transcribeAudio(file as Blob, filename);
    if (!transcript) {
      return NextResponse.json(
        { error: "Не удалось распознать голос — попробуйте ещё раз" },
        { status: 400 }
      );
    }

    // 2) Извлекаем задачу
    const task = await extractTask(transcript);

    // 3) Сохраняем в tasks (status='new' — попадает в колонку «Новое»)
    // created_by_tg_id обязателен в схеме — используем 0 как маркер "с фронта".
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
    const insertBody = {
      description: task.description,
      assignee: task.assignee,
      due_date: task.due_date,
      status: "new",
      source: "voice",
      created_by_tg_id: 0,
    };
    const { data: inserted, error } = await supabase
      .from("tasks")
      .insert(insertBody)
      .select()
      .single();
    if (error) {
      return NextResponse.json(
        { error: `Supabase: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      transcript,
      task: { ...inserted, title: task.title },
    });
  } catch (e: any) {
    console.error("Voice task error:", e);
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
