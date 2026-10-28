"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmCard from "@/components/ConfirmCard";
import { addMeal, getSettings, logEvent } from "@/lib/db";
import type { EstimateResponse } from "@/lib/estimate/schema";
import { compressImage } from "@/lib/image";
import type { InputType, Meal, Settings } from "@/lib/types";
import halls from "@/data/dining/uchicago/halls.json";

type Phase =
  | { kind: "input" }
  | { kind: "loading"; inputType: InputType; preview?: string }
  | { kind: "confirm"; inputType: InputType; result: Extract<EstimateResponse, { ok: true }> }
  | { kind: "error"; inputType: InputType; message: string; retryable: boolean };

type PhotoType = Exclude<InputType, "text">;

const PHOTO_BUTTONS: { type: PhotoType; label: string; hint: string }[] = [
  { type: "receipt", label: "拍餐厅小票", hint: "一张解决记账 + 记餐" },
  { type: "photo", label: "拍餐食", hint: "食堂等没小票的场景" },
  { type: "grocery", label: "拍买菜小票", hint: "只记花销,食材存档" },
];

export default function LogPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "input" });
  const [text, setText] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  // "" = not a dining hall. Defaults to the hall saved in settings; the chips override per record.
  const [hall, setHall] = useState("");
  const startTs = useRef(0); // set in useEffect: Date.now() must not run during prerender

  useEffect(() => {
    startTs.current = Date.now();
    void logEvent("record_start");
    getSettings().then((s) => {
      setSettings(s);
      if (s?.dining_hall) setHall(s.dining_hall);
    });
  }, []);

  async function runEstimate(body: { type: InputType; content: string }, preview?: string) {
    setPhase({ kind: "loading", inputType: body.type, preview });
    // Dining-hall context applies to plates and sentences, never to receipts.
    const withHall = hall && (body.type === "photo" || body.type === "text") ? { ...body, dining_hall: hall } : body;
    try {
      const res = await fetch("/api/estimate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(withHall),
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

  return (
    <div className="space-y-5 py-2">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">记一餐</h1>
        <button onClick={cancel} className="text-sm text-zinc-500">
          取消
        </button>
      </div>

      {phase.kind === "input" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2" data-testid="hall-chips">
            <span className="text-xs text-zinc-500">在食堂?</span>
            <Chip active={hall === ""} onClick={() => setHall("")} label="不是" />
            {halls.halls.map((h) => (
              <Chip key={h.slug} active={hall === h.slug} onClick={() => setHall(h.slug)} label={h.short} />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {PHOTO_BUTTONS.map((b) => (
              <label
                key={b.type}
                className={`cursor-pointer rounded-2xl p-3 text-left shadow-sm ${
                  b.type === "receipt" ? "bg-green-600 text-white" : "bg-white"
                }`}
              >
                <PhotoInput type={b.type} onFile={onFile} />
                <span className="block text-sm font-semibold">{b.label}</span>
                <span className={`mt-1 block text-[11px] leading-tight ${b.type === "receipt" ? "text-green-100" : "text-zinc-500"}`}>
                  {b.hint}
                </span>
              </label>
            ))}
          </div>

          <div className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
            <label className="block text-sm font-medium text-zinc-700">或者一句话</label>
            <textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitText();
                }
              }}
              placeholder={hall ? "例如:炒蛋两份、烤鸡胸一块、米饭半碗" : "例如:Chipotle 鸡肉碗 $11.5"}
              className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-base outline-none focus:border-green-600"
            />
            <button
              onClick={submitText}
              disabled={!text.trim()}
              className="w-full rounded-xl bg-zinc-900 py-3 font-semibold text-white disabled:opacity-40"
            >
              解析
            </button>
          </div>
        </div>
      )}

      {phase.kind === "loading" && (
        <div className="flex flex-col items-center gap-3 py-10 text-zinc-500">
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
      className={`rounded-full border px-3 py-1 text-sm ${
        active ? "border-amber-500 bg-amber-100 text-amber-900" : "border-zinc-300 bg-white text-zinc-600"
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
