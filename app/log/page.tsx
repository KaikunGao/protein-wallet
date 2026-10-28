"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmCard from "@/components/ConfirmCard";
import VoiceButton from "@/components/VoiceButton";
import { addMeal, getSettings, logEvent } from "@/lib/db";
import type { EstimateResponse } from "@/lib/estimate/schema";
import { compressImage } from "@/lib/image";
import { CURRENCIES, currencyOf } from "@/lib/money";
import type { InputType, Meal, Settings } from "@/lib/types";
import halls from "@/data/dining/uchicago/halls.json";

type Phase =
  | { kind: "input" }
  | { kind: "loading"; inputType: InputType; preview?: string }
  | { kind: "confirm"; inputType: InputType; result: Extract<EstimateResponse, { ok: true }> }
  | { kind: "error"; inputType: InputType; message: string; retryable: boolean };

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
  // "" = not a dining hall. Defaults to the hall saved in settings; the chips override per record.
  const [hall, setHall] = useState("");
  const startTs = useRef(0); // set in useEffect: Date.now() must not run during prerender
  const voiceBase = useRef(""); // text already in the box when a voice session starts
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    startTs.current = Date.now();
    void logEvent("record_start");
    getSettings().then((s) => {
      setSettings(s);
      if (s?.dining_hall) setHall(s.dining_hall);
    });
  }, []);

  const currency = currencyOf(settings?.currency);
  const sym = CURRENCIES[currency].symbol;

  async function runEstimate(body: { type: InputType; content: string }, preview?: string) {
    setPhase({ kind: "loading", inputType: body.type, preview });
    // Dining-hall context applies to plates and sentences, never to receipts.
    const withHall = hall && (body.type === "photo" || body.type === "text") ? { ...body, dining_hall: hall } : body;
    const payload = { ...withHall, currency };
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
        dining_hall: "dining_hall" in withHall ? withHall.dining_hall : null,
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
      n: meals.length,
      corrected: meta.corrected,
      duration_ms: Date.now() - startTs.current,
    });
    router.push("/");
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

  const example = hall ? `例如:炒蛋两勺、烤鸡胸一块、米饭半碗` : `例如:Chipotle 鸡肉碗 ${sym}11.5`;

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">记一餐</h1>
        <button onClick={cancel} className="text-sm text-zinc-500">
          取消
        </button>
      </div>

      {phase.kind === "input" && (
        <div className="space-y-4">
          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-zinc-500">在哪吃的?</p>
            <div className="mt-2 flex flex-wrap gap-2" data-testid="hall-chips">
              <Chip active={hall === ""} onClick={() => setHall("")} label="不是食堂" />
              {halls.halls.map((h) => (
                <Chip key={h.slug} active={hall === h.slug} onClick={() => setHall(h.slug)} label={h.short} />
              ))}
            </div>
            {hall && (
              <p className="mt-2 text-[11px] leading-snug text-amber-800">
                会按这家食堂的官方菜品库算每道菜,份数看图估,记得核对。
              </p>
            )}
          </section>

          <section className="grid grid-cols-3 gap-2">
            {PHOTO_BUTTONS.map((b) => {
              const primary = b.type === "receipt";
              return (
                <label
                  key={b.type}
                  className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl px-2 py-4 text-center shadow-sm transition active:scale-[0.97] ${
                    primary ? "bg-green-600 text-white" : "bg-white text-zinc-800"
                  }`}
                >
                  <PhotoInput type={b.type} onFile={onFile} />
                  <span className={primary ? "text-white" : "text-green-700"}>{b.icon}</span>
                  <span className="text-sm font-semibold">{b.label}</span>
                  <span className={`text-[11px] leading-tight ${primary ? "text-green-100" : "text-zinc-500"}`}>{b.hint}</span>
                </label>
              );
            })}
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium text-zinc-700">或者说一句、打一句</p>
              <span className="text-[11px] text-zinc-400">{hall ? "说菜名和份数" : "带上价格更好"}</span>
            </div>
            <textarea
              ref={textareaRef}
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitText();
                }
              }}
              placeholder={example}
              className="mt-2 w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base outline-none focus:border-green-600 focus:bg-white"
            />
            <div className="mt-3 flex items-center gap-3">
              <VoiceButton onStart={onVoiceStart} onText={onVoiceText} />
              <button
                onClick={submitText}
                disabled={!text.trim()}
                className="h-12 flex-1 rounded-xl bg-green-600 font-semibold text-white transition disabled:bg-zinc-200 disabled:text-zinc-400"
              >
                解析
              </button>
            </div>
          </section>
        </div>
      )}

      {phase.kind === "loading" && (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white py-10 text-zinc-500 shadow-sm">
          {phase.preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={phase.preview} alt="" className="max-h-48 rounded-xl object-contain" />
          )}
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-green-600" />
          <p>AI 解析中…</p>
        </div>
      )}

      {phase.kind === "error" && (
        <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm">
          <p className="font-medium text-red-700">{phase.message}</p>
          <div className="flex gap-3">
            {phase.retryable && phase.inputType === "text" && (
              <button onClick={submitText} className="flex-1 rounded-xl bg-green-600 py-3 font-semibold text-white">
                重试
              </button>
            )}
            {phase.inputType !== "text" && (
              <label className="flex-1 cursor-pointer rounded-xl bg-green-600 py-3 text-center font-semibold text-white">
                <PhotoInput type={phase.inputType as PhotoType} onFile={onFile} />
                重拍
              </label>
            )}
            <button
              onClick={() => setPhase({ kind: "input" })}
              className="flex-1 rounded-xl border border-zinc-300 bg-white py-3 font-medium"
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
          defaultAmount={settings?.meal_swipe_usd ?? null}
          currency={currency}
          onSave={onSave}
          onCancel={cancel}
        />
      )}
    </div>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-sm transition ${
        active ? "border-amber-500 bg-amber-100 font-medium text-amber-900" : "border-zinc-200 bg-white text-zinc-600"
      }`}
    >
      {label}
    </button>
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
