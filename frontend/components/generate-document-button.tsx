"use client";

import { useEffect, useState } from "react";
import {
  FileText,
  Loader2,
  X,
  Copy,
  Check,
  Download,
  Printer,
  BookOpenText,
} from "lucide-react";

type Reference = {
  source: string;
  chunk_index: number;
  similarity: number;
  snippet: string;
};

type GenerateResult = {
  document: string;
  title: string;
  references: Reference[];
  used_sources: string[];
  request: string;
};

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "success"; result: GenerateResult };

// Вызываем Next.js API route (см. app/api/rag/generate-document/route.ts)
const GENERATE_ENDPOINT = "/api/rag/generate-document";

export function GenerateDocumentButton() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  // ESC — закрыть
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function openModal() {
    setPrompt("");
    setState({ kind: "idle" });
    setCopied(false);
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
  }

  async function submit() {
    const req = prompt.trim();
    if (!req) return;
    setState({ kind: "loading" });

    try {
      const resp = await fetch(GENERATE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: req }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setState({
          kind: "error",
          message: data?.error || "Ошибка сервера",
        });
        return;
      }
      setState({ kind: "success", result: data as GenerateResult });
    } catch (e: any) {
      setState({
        kind: "error",
        message: e?.message || "Сетевая ошибка",
      });
    }
  }

  async function copyToClipboard() {
    if (state.kind !== "success") return;
    try {
      await navigator.clipboard.writeText(state.result.document);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  function downloadTxt() {
    if (state.kind !== "success") return;
    const { document: doc, title } = state.result;
    const blob = new Blob([doc], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeTitle = (title || "Распоряжение")
      .replace(/[\\/:*?"<>|]/g, "")
      .slice(0, 80)
      .trim();
    a.download = `${safeTitle || "Распоряжение"}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function printAsPdf() {
    if (state.kind !== "success") return;
    const { document: doc, title, used_sources } = state.result;
    const win = window.open("", "_blank", "width=900,height=1000");
    if (!win) return;
    const sourcesLine = used_sources.length
      ? `<p class="sources">Сформировано на основе: ${used_sources
          .map((s) => `<strong>${escapeHtml(s)}</strong>`)
          .join(", ")}</p>`
      : "";
    win.document.write(`
      <!doctype html>
      <html lang="ru"><head><meta charset="utf-8"/>
      <title>${escapeHtml(title || "Распоряжение")}</title>
      <style>
        body{font-family:'Times New Roman',serif;max-width:720px;margin:40px auto;padding:0 24px;color:#000;line-height:1.55;}
        h1{font-size:22px;text-align:center;margin:0 0 8px;}
        h2{font-size:18px;margin:24px 0 12px;}
        p{margin:10px 0;}
        .sources{margin-top:40px;padding-top:16px;border-top:1px solid #999;font-size:12px;color:#555;}
        ol,ul{padding-left:22px;}
        pre{white-space:pre-wrap;font-family:inherit;font-size:14px;}
      </style></head><body>
      <pre>${escapeHtml(doc)}</pre>
      ${sourcesLine}
      <script>window.onload = () => { window.print(); };<\/script>
      </body></html>
    `);
    win.document.close();
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border bg-card hover:bg-card/70 text-foreground text-sm transition shadow-sm hover:shadow-neon-sm"
      >
        <BookOpenText className="h-4 w-4" />
        Сгенерировать документ по базе знаний
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="w-full max-w-3xl max-h-[90vh] rounded-lg border border-border bg-card shadow-xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">
                  Генерация распоряжения (RAG)
                </h2>
              </div>
              <button
                onClick={closeModal}
                className="text-muted-foreground hover:text-foreground transition"
                aria-label="Закрыть"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {/* Ввод */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Опишите суть распоряжения
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Например: подготовь приказ о замене учителя математики Ивановой на 20.04.2026"
                  rows={3}
                  disabled={state.kind === "loading"}
                  className="w-full resize-none rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
                />
                <p className="text-xs text-muted-foreground">
                  ИИ найдёт релевантные пункты из приказов в базе и составит
                  документ со ссылками.
                </p>
              </div>

              {/* Состояние */}
              {state.kind === "loading" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Ищу в базе знаний и составляю распоряжение...
                </div>
              )}

              {state.kind === "error" && (
                <div className="rounded-md border border-red-500 bg-red-500/10 text-sm text-foreground px-3 py-2">
                  {state.message}
                </div>
              )}

              {state.kind === "success" && (
                <>
                  {/* Плашка с источниками */}
                  {state.result.used_sources.length > 0 ? (
                    <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-foreground">
                      <BookOpenText className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                      <div>
                        Сформировано на основе:{" "}
                        {state.result.used_sources.map((s, i) => (
                          <span key={s}>
                            <strong>{s}</strong>
                            {i < state.result.used_sources.length - 1
                              ? ", "
                              : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 text-xs text-foreground px-3 py-2">
                      ⚠ Релевантных фрагментов в базе знаний не найдено —
                      документ составлен по общим нормам.
                    </div>
                  )}

                  {/* Текст документа */}
                  <div className="rounded-md border border-border bg-background/40 px-4 py-4">
                    <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed">
                      {state.result.document}
                    </pre>
                  </div>

                  {/* Источники (развёрнутый список) */}
                  {state.result.references.length > 0 && (
                    <details className="rounded-md border border-border bg-background/30 px-3 py-2 text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Показать найденные фрагменты ({state.result.references.length})
                      </summary>
                      <div className="mt-2 space-y-2">
                        {state.result.references.map((r, i) => (
                          <div
                            key={`${r.source}-${r.chunk_index}-${i}`}
                            className="border-l-2 border-primary/50 pl-2"
                          >
                            <div className="text-foreground font-medium">
                              {r.source} · фрагмент {r.chunk_index}{" "}
                              <span className="text-muted-foreground font-normal">
                                (сходство {r.similarity})
                              </span>
                            </div>
                            <div className="text-muted-foreground italic">
                              {r.snippet}
                              {r.snippet.length >= 240 ? "..." : ""}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 px-6 py-3 border-t border-border bg-background/30">
              <div className="flex gap-2">
                {state.kind === "success" && (
                  <>
                    <button
                      onClick={copyToClipboard}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-card hover:bg-card/70 text-sm text-foreground transition"
                    >
                      {copied ? (
                        <>
                          <Check className="h-4 w-4 text-emerald-500" />{" "}
                          Скопировано
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" /> Копировать
                        </>
                      )}
                    </button>
                    <button
                      onClick={downloadTxt}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-card hover:bg-card/70 text-sm text-foreground transition"
                    >
                      <Download className="h-4 w-4" /> Скачать .txt
                    </button>
                    <button
                      onClick={printAsPdf}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary/50 bg-primary/10 hover:bg-primary/20 text-sm text-foreground transition"
                    >
                      <Printer className="h-4 w-4" /> Печать / PDF
                    </button>
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={closeModal}
                  className="px-3 py-1.5 rounded-md border border-border bg-card hover:bg-card/70 text-sm text-foreground transition"
                >
                  Закрыть
                </button>
                <button
                  onClick={submit}
                  disabled={state.kind === "loading" || !prompt.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md border border-primary bg-primary text-primary-foreground hover:opacity-90 text-sm transition disabled:opacity-50"
                >
                  {state.kind === "loading" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Генерирую...
                    </>
                  ) : state.kind === "success" ? (
                    "Сгенерировать заново"
                  ) : (
                    "Сгенерировать"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
