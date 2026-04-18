import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";

const WHISPER_MODEL = "whisper-large-v3";
const LLM_MODEL = "llama-3.3-70b-versatile";

// Ключевые глаголы действия для Intent Guard
const ACTION_VERBS = [
  "напиши", "напишите", "подготовь", "подготовьте", "проверь", "проверьте",
  "собери", "соберите", "организуй", "организуйте", "отправь", "отправьте",
  "составь", "составьте", "сделай", "сделайте", "купи", "купите",
  "позвони", "позвоните", "назначь", "назначьте", "передай", "передайте",
  "закажи", "закажите", "принеси", "принесите", "создай", "создайте",
  "обнови", "обновите", "исправь", "исправьте", "разработай", "разработайте",
  "представь", "представьте", "распечатай", "распечатайте", "напомни", "напомните",
  "убери", "уберите", "почини", "почините", "проведи", "проведите",
  "разошли", "разошлите", "оформи", "оформите", "внеси", "внесите",
  "найди", "найдите", "замени", "замените", "установи", "установите",
  "запиши", "запишите", "посчитай", "посчитайте", "скажи", "скажите",
  "запусти", "запустите", "удали", "удалите", "добавь", "добавьте",
  "проконтролируй", "сообщи", "сообщите", "уведоми", "уведомите",
  "договорись", "договоритесь", "поручи", "поручите", "нужно", "надо",
  "следует", "должен", "должна", "должны",
];

// Стоп-фразы
const STOP_PHRASES = [
  "добрый день", "добрый вечер", "доброе утро", "здравствуй", "здравствуйте",
  "привет", "приветствую", "как дела", "как ты", "как вы", "спасибо",
  "пожалуйста", "окей", "ок", "да", "нет", "ага", "угу", "хорошо",
  "понял", "поняла", "поняли", "что делать", "что думаешь", "как тебе",
];

function heuristicIsValid(text: string): boolean | null {
  const clean = text.toLowerCase().trim();
  
  if (clean.length < 5) return false;
  if (STOP_PHRASES.includes(clean)) return false;
  
  const words = clean.split(/\s+/);
  for (const word of words) {
    const wordClean = word.replace(/[.,!?;:]+$/, "");
    if (ACTION_VERBS.includes(wordClean)) return true;
  }
  
  return null;
}

async function parseTasksFromText(text: string, staffList: any[]): Promise<{ valid: boolean; tasks?: any[]; reason?: string; message?: string }> {
  const heuristic = heuristicIsValid(text);
  if (heuristic === false) {
    return {
      valid: false,
      reason: "not_a_task",
      message: "Фраза не содержит поручения",
    };
  }
  
  const staffNames = staffList.map((s: any) => s.fio).join(", ");
  const today = new Date().toISOString().slice(0, 10);
  
  const systemPrompt = `Ты — СТРОГИЙ Intent Guard для системы управления школой. Твоя задача — фильтровать голосовые команды директора.

ДОМЕН: только школьное управление — замены, столовая, хоз. поручения, приказы, отчёты, родительские собрания, проверки, организация мероприятий.

Список сотрудников: ${staffNames}
Сегодня: ${today}

АЛГОРИТМ:
1. Если фраза — случайный разговор, шум, приветствие, междометие или бессмыслица → valid=false, reason="not_a_task"
2. Если фраза похожа на поручение, но БЕЗ конкретики (нет что делать или с чем) → valid=false, reason="missing_details"
3. Только если фраза — ЯВНОЕ школьное поручение с конкретикой → valid=true + список задач

ПРИМЕРЫ ОТКАЗОВ:
Вход: "Привет, как дела"
Выход: {"valid": false, "reason": "not_a_task", "message": "Это приветствие, не поручение"}

Вход: "Эй, сделай там что-нибудь"
Выход: {"valid": false, "reason": "missing_details", "message": "Неясно что именно нужно сделать"}

Вход: "спасибо, окей, понял"
Выход: {"valid": false, "reason": "not_a_task", "message": "Подтверждения не являются задачами"}

ПРИМЕРЫ ВАЛИДНЫХ ЗАДАЧ:
Вход: "Напишите отчёт по 5А классу к пятнице"
Выход: {"valid": true, "tasks": [{"description": "Написать отчёт по 5А классу", "assignee": null, "due_date": "YYYY-MM-DD (пятница)"}]}

Вход: "Иван Петрович подготовьте замену на завтра для Сидоровой"
Выход: {"valid": true, "tasks": [{"description": "Подготовить замену для Сидоровой", "assignee": "Иван Петрович...", "due_date": "завтрашняя дата"}]}

Формат ответа — строго JSON:
Для валидных: {"valid": true, "tasks": [{"description": "...", "assignee": "ФИО или null", "due_date": "YYYY-MM-DD или null"}]}
Для невалидных: {"valid": false, "reason": "not_a_task" | "missing_details", "message": "короткое объяснение на русском"}`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        response_format: { type: "json_object" },
        temperature: 0.0,
      }),
    });
    
    if (!response.ok) {
      const t = await response.text();
      throw new Error(`LLM ${response.status}: ${t}`);
    }
    
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    
    if (parsed.valid === false) {
      return {
        valid: false,
        reason: parsed.reason || "not_a_task",
        message: parsed.message || "ИИ не распознал задачу",
      };
    }
    
    const tasks = parsed.tasks || [];
    const validTasks = tasks.filter((t: any) => t.description && t.description.length >= 3);
    
    if (validTasks.length === 0) {
      return {
        valid: false,
        reason: "not_a_task",
        message: "ИИ не нашёл конкретных поручений в фразе",
      };
    }
    
    return { valid: true, tasks: validTasks };
  } catch (error: any) {
    console.error("Intent Guard error:", error);
    return {
      valid: false,
      reason: "llm_error",
      message: `Ошибка AI: ${error.message}`,
    };
  }
}

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
  return (await resp.text()).trim();
}

export async function POST(req: NextRequest) {
  try {
    if (!GROQ_API_KEY) {
      return NextResponse.json(
        { error: "GROQ_API_KEY не задан на сервере" },
        { status: 500 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
    
    // Получаем список сотрудников для Intent Guard
    const { data: staffList } = await supabase.from("staff").select("fio");
    
    // Проверяем, передан ли текст напрямую (от Web Speech API) или аудио файл
    const contentType = req.headers.get("content-type") || "";
    let transcript = "";
    
    if (contentType.includes("application/json")) {
      // Текст от Web Speech API
      const body = await req.json();
      transcript = body.text || "";
    } else {
      // Аудио файл
      const form = await req.formData();
      const file = form.get("audio") as File | null;
      if (!file || typeof file === "string") {
        return NextResponse.json(
          { error: "Отсутствует поле audio" },
          { status: 400 }
        );
      }
      const filename = file.name && file.name.length > 0 ? file.name : "voice.webm";
      transcript = await transcribeAudio(file as Blob, filename);
    }
    
    if (!transcript) {
      return NextResponse.json(
        { error: "Не удалось распознать голос — попробуйте ещё раз" },
        { status: 400 }
      );
    }

    // Intent Guard
    const result = await parseTasksFromText(transcript, staffList || []);
    
    if (!result.valid) {
      return NextResponse.json(
        {
          valid: false,
          transcript,
          tasks: [],
          reason: result.reason,
          error: result.message,
        },
        { status: 400 }
      );
    }

    // Создаём задачи
    const createdTasks = [];
    for (const taskData of result.tasks || []) {
      const insertBody = {
        description: taskData.description,
        assignee: taskData.assignee || null,
        due_date: taskData.due_date || null,
        status: "new",
        source: "voice",
        created_by_tg_id: 0,
      };
      const { data: inserted, error } = await supabase
        .from("tasks")
        .insert(insertBody)
        .select()
        .single();
      
      if (!error && inserted) {
        createdTasks.push(inserted);
      }
    }

    return NextResponse.json({
      valid: true,
      transcript,
      tasks: createdTasks,
      count: createdTasks.length,
    });
  } catch (e: any) {
    console.error("Voice task error:", e);
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
