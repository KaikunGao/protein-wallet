"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmCard from "@/components/ConfirmCard";
import { addMeal, getSettings, logEvent } from "@/lib/db";
import type { EstimateResponse } from "@/lib/estimate/schema";
import type { InputType, Meal, Settings } from "@/lib/types";

type Phase =
  | { kind: "input" }
  | { kind: "loading"; inputType: InputType }
  | { kind: "confirm"; inputType: InputType; result: Extract<EstimateResponse, { ok: true }> }
  | { kind: "error"; inputType: InputType; message: string; retryable: boolean };

export default function LogPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "input" });
  const [text, setText] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const startTs = useRef(0); // set in useEffect: Date.now() must not run during prerender

  useEffect(() => {
    startTs.current = Date.now();
    void logEvent("record_start");
    getSettings().then(setSettings);
  }, []);

  async function runEstimate(body: { type: InputType; content: string; media_type?: string }) {
    setPhase({ kind: "loading", inputType: body.type });
    try {
      const res = await fetch("/api/estimate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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
          <div className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
            <label className="block text-sm font-medium text-zinc-700">一句话</label>
            <textarea
              autoFocus
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitText();
                }
              }}
              placeholder="例如:Chipotle 鸡肉碗 $11.5"
              className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-base outline-none focus:border-green-600"
            />
            <button
              onClick={submitText}
              disabled={!text.trim()}
              className="w-full rounded-xl bg-green-600 py-3 font-semibold text-white disabled:opacity-40"
            >
              解析
            </button>
          </div>
          {/* Photo / receipt / grocery inputs arrive in Step 2.2 / 2.3 */}
          <p className="px-1 text-xs text-zinc-400">
            拍小票 / 拍餐食 / 买菜小票:下周上线。
          </p>
        </div>
      )}

      {phase.kind === "loading" && (
        <div className="flex flex-col items-center gap-3 py-16 text-zinc-500">
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
