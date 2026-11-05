"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmCard from "@/components/ConfirmCard";
import FeedbackCard from "@/components/FeedbackCard";
import VoiceButton from "@/components/VoiceButton";
import { addMeal, getSettings, listMealsByDay, listMealsByWeek, listMealsSince, logEvent } from "@/lib/db";
import type { EstimateResponse } from "@/lib/estimate/schema";
import { buildFeedback, type Feedback } from "@/lib/feedback";
import { compressImage } from "@/lib/image";
import { currencyOf } from "@/lib/money";
import type { InputType, Meal, Settings } from "@/lib/types";

type Phase =
  | { kind: "input" }
  | { kind: "loading"; inputType: InputType; preview?: string }
  | { kind: "confirm"; inputType: InputType; result: Extract<EstimateResponse, { ok: true }> }
  | { kind: "error"; inputType: InputType; message: string; retryable: boolean }
  | { kind: "saved"; feedback: Feedback };

// 记一餐 = one meal now (photo / receipt / sentence). 日结 = one sentence for the whole day,
// split into one record per 顿 (PRD 2026-11-04 记录成本方案 #1).
type Mode = "meal" | "day";
const HISTORY_DAYS = 30;

type PhotoType = Exclude<InputType, "text">;

const PHOTO_BUTTONS: { type: PhotoType; label: string; hint: string; icon: React.ReactNode }[] = [
  {
    type: "receipt",
    label: "拍小票",
    hint: "记账 + 记餐一步到位",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </svg>
    ),
  },
  {
    type: "photo",
    label: "拍餐盘",
    hint: "食堂、外卖、自己做",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 7.5v1.5" />
      </svg>
    ),
  },
  {
    type: "grocery",
    label: "买菜小票",
    hint: "只记花销",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6.5" />
        <circle cx="9.5" cy="20" r="1.3" />
        <circle cx="16.5" cy="20" r="1.3" />
      </svg>
    ),
  },
];

export default function LogPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "input" });
  const [text, setText] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<Mode>("meal");
  const startTs = useRef(0); // set in useEffect: Date.now() must not run during prerender
  const voiceBase = useRef(""); // text already in the box when a voice session starts
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    startTs.current = Date.now();
    // /log?mode=day comes from the home page's 日结 link; read it here so the page stays static.
    const day = new URLSearchParams(window.location.search).get("mode") === "day";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (day) setMode("day");
    void logEvent("record_start", { mode: day ? "day" : "meal" });
    getSettings().then(setSettings);
  }, []);

  const currency = currencyOf(settings?.currency);

  async function runEstimate(body: { type: InputType; content: string }, preview?: string) {
    setPhase({ kind: "loading", inputType: body.type, preview });
    // dining_hall is not sent: the 国内 食堂菜品库 does not exist yet (PRD 国内版 step 4).
    const payload = { ...body, currency, ...(body.type === "text" && mode === "day" ? { batch: true } : {}) };
    try {
      const res = await fetch("/api/estimate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as EstimateResponse;
      if (!data.ok) {
        void logEvent("record_failed", { input_type: body.type, error: data.error });
        setPhase({ kind: "error", inputType: body.type, message: data.error, retryable: data.retryable });
        return;
      }
      void logEvent("record_parsed", {
        input_type: body.type,
        items: data.kind === "meal" ? data.items.length : 0,
        sources: data.kind === "meal" ? data.items.map((i) => i.source) : ["grocery"],
        ms: Date.now() - startTs.current,
      });
      setPhase({ kind: "confirm", inputType: body.type, result: data });
    } catch {
      void logEvent("record_failed", { input_type: body.type, error: "network" });
      setPhase({ kind: "error", inputType: body.type, message: "网络出错,请重试", retryable: true });
    }
  }

  function submitText() {
    const content = text.trim();
    if (!content) return;
    void runEstimate({ type: "text", content });
  }

  async function onFile(type: PhotoType, file: File) {
    let dataUrl: string;
    try {
      dataUrl = await compressImage(file);
    } catch (e) {
      setPhase({
        kind: "error",
        inputType: type,
        message: e instanceof Error ? e.message : "图片无法读取",
        retryable: true,
      });
      return;
    }
    void runEstimate({ type, content: dataUrl }, dataUrl);
  }

  async function onSave(meals: Meal[], meta: { corrected: boolean }) {
    for (const m of meals) await addMeal(m);
    void logEvent("record_saved", {
      input_type: meals[0]?.input_type,
      mode,
      n: meals.length,
      corrected: meta.corrected,
      duration_ms: Date.now() - startTs.current,
    });
    const s = settings ?? (await getSettings());
    if (!s || meals.every((m) => m.kind === "grocery")) {
      router.push("/");
      return;
    }
    // 即时回报: rank this meal within the week and turn today's gap into the cheapest
    // item from the user's own history (PRD 记录成本方案 #3).
    const [today, week, history] = await Promise.all([
      listMealsByDay(),
      listMealsByWeek(),
      listMealsSince(Date.now() - HISTORY_DAYS * 86400e3),
    ]);
    const feedback = buildFeedback(meals, week, today, history, s);
    void logEvent("feedback_shown", {
      where: "log",
      rank: feedback.rank?.rank ?? null,
      total: feedback.rank?.total ?? null,
      deficit: Math.round(feedback.deficit),
      suggestion: feedback.suggestion?.name ?? null,
    });
    setPhase({ kind: "saved", feedback });
  }

  function another() {
    startTs.current = Date.now();
    setText("");
    void logEvent("record_start", { mode, after_feedback: true });
    setPhase({ kind: "input" });
  }

  function cancel() {
    void logEvent("record_cancelled");
    router.push("/");
  }

  function onVoiceStart() {
    voiceBase.current = text.trim();
    void logEvent("record_start", { voice: true });
  }
  function onVoiceText(t: string, final: boolean) {
    const base = voiceBase.current;
    setText(base ? `${base} ${t}` : t);
    if (final) textareaRef.current?.focus();
  }

  const example =
    mode === "day"
      ? "早饭鸡蛋牛奶 5 元、午饭食堂鸡腿饭 12 元、晚饭外卖黄焖鸡 22 元、一勺蛋白粉"
      : "例如:食堂红烧鸡腿 + 米饭 12 元";

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-end justify-between">
        <div>
          <p className="label-xs">记录</p>
          <h1 className="text-2xl font-bold tracking-tight">{mode === "day" ? "日结" : "记一餐"}</h1>
        </div>
        {phase.kind !== "saved" && (
          <button onClick={cancel} className="text-sm text-ink-400">
            取消
          </button>
        )}
      </div>

      {phase.kind === "input" && (
        <div className="space-y-4">
          <div className="flex rounded-2xl bg-ink-100 p-1" role="tablist" data-testid="mode-toggle">
            {(["meal", "day"] as Mode[]).map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setMode(m);
                    void logEvent("record_start", { mode: m, switched: true });
                  }}
                  className={`flex-1 rounded-xl py-2 text-sm transition ${active ? "bg-white font-semibold text-ink-900 shadow-sm" : "text-ink-600"}`}
                >
                  {m === "meal" ? "记一餐" : "日结 · 一句话记一天"}
                </button>
              );
            })}
          </div>

          {mode === "day" && (
            <p className="text-sm text-ink-600" data-testid="day-hint">
              睡前一句话,把今天吃的按顿写出来,用顿号分开,带上价格。会拆成一条一条,保存前可以改。
            </p>
          )}

          {mode === "meal" && (
          <section className="grid grid-cols-3 gap-2">
            {PHOTO_BUTTONS.map((b) => {
              const primary = b.type === "receipt";
              return (
                <label
                  key={b.type}
                  className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-[1.25rem] px-2 py-4 text-center transition active:scale-[0.97] ${
                    primary ? "bg-brand-600 text-white shadow-[0_10px_24px_-12px_rgb(21_128_61/0.8)]" : "card text-ink-900"
                  }`}
                >
                  <PhotoInput type={b.type} onFile={onFile} />
                  <span className={primary ? "text-white" : "text-brand-600"}>{b.icon}</span>
                  <span className="text-sm font-semibold">{b.label}</span>
                  <span className={`text-[11px] leading-tight ${primary ? "text-green-100" : "text-ink-400"}`}>{b.hint}</span>
                </label>
              );
            })}
          </section>
          )}

          <section className="card p-4">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium text-ink-900">{mode === "day" ? "今天吃了什么" : "或者说一句、打一句"}</p>
              <span className="text-[11px] text-ink-400">{mode === "day" ? "一顿一个价格" : "带上价格更好"}</span>
            </div>
            <textarea
              ref={textareaRef}
              rows={mode === "day" ? 4 : 3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitText();
                }
              }}
              placeholder={example}
              className="input-base mt-2 resize-none bg-paper focus:bg-white"
            />
            <div className="mt-3 flex items-center gap-3">
              <VoiceButton onStart={onVoiceStart} onText={onVoiceText} />
              <button
                onClick={submitText}
                disabled={!text.trim()}
                className="btn-primary h-12 flex-1"
              >
                {mode === "day" ? "拆成一条条" : "解析"}
              </button>
            </div>
          </section>
        </div>
      )}

      {phase.kind === "loading" && (
        <div className="card flex flex-col items-center gap-3 py-10 text-ink-400">
          {phase.preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={phase.preview} alt="" className="max-h-48 rounded-xl object-contain" />
          )}
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-ink-100 border-t-brand-600" />
          <p>AI 解析中…</p>
        </div>
      )}

      {phase.kind === "error" && (
        <div className="card space-y-4 p-4">
          <p className="font-medium text-red-700">{phase.message}</p>
          <div className="flex gap-3">
            {phase.retryable && phase.inputType === "text" && (
              <button onClick={submitText} className="btn-primary flex-1 py-3">
                重试
              </button>
            )}
            {phase.inputType !== "text" && (
              <label className="btn-primary flex-1 cursor-pointer py-3 text-center">
                <PhotoInput type={phase.inputType as PhotoType} onFile={onFile} />
                重拍
              </label>
            )}
            <button
              onClick={() => setPhase({ kind: "input" })}
              className="btn-secondary flex-1 py-3"
            >
              改用文字输入
            </button>
          </div>
        </div>
      )}

      {phase.kind === "confirm" && (
        <ConfirmCard
          result={phase.result}
          inputType={phase.inputType}
          currency={currency}
          onSave={onSave}
          onCancel={cancel}
        />
      )}

      {phase.kind === "saved" && (
        <FeedbackCard feedback={phase.feedback} currency={currency} onDone={() => router.push("/")} onMore={another} />
      )}
    </div>
  );
}

/** Hidden file input; wrapped in a <label> so taps open the camera without JS click(). */
function PhotoInput({ type, onFile }: { type: PhotoType; onFile: (t: PhotoType, f: File) => void }) {
  return (
    <input
      type="file"
      accept="image/*"
      capture="environment"
      className="hidden"
      data-testid={`input-${type}`}
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onFile(type, f);
        e.target.value = "";
      }}
    />
  );
}
