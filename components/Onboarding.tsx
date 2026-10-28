"use client";

import { useState } from "react";
import { logEvent, saveSettings } from "@/lib/db";
import { CURRENCIES, type Currency } from "@/lib/money";
import { buildSettings, proteinTargetFromWeight } from "@/lib/settings";
import type { Settings } from "@/lib/types";

// First-launch flow: two questions, no account. Weight is optional.
export default function Onboarding({ onDone }: { onDone: (s: Settings) => void }) {
  const [step, setStep] = useState<0 | 1>(0);
  const [weight, setWeight] = useState("");
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");

  const target = proteinTargetFromWeight(weight ? Number(weight) : null);

  async function finish() {
    const s = buildSettings({
      weight_kg: weight ? Number(weight) : null,
      weekly_budget_usd: Number(budget),
      currency,
    });
    await saveSettings(s);
    void logEvent("page_open", { page: "onboarding_done", weight_given: !!weight });
    onDone(s);
  }

  return (
    <div className="flex min-h-[78dvh] flex-col justify-center gap-6 py-6 rise">
      <div>
        <p className="text-sm font-semibold text-brand-600">蛋白钱包</p>
        <p className="mt-1 text-xs text-ink-400">每一块钱换到多少克蛋白质</p>
        <div className="mt-5 flex gap-1.5">
          <span className={`h-1.5 w-8 rounded-full ${step === 0 ? "bg-brand-600" : "bg-brand-200"}`} />
          <span className={`h-1.5 w-8 rounded-full ${step === 1 ? "bg-brand-600" : "bg-ink-200"}`} />
        </div>
        <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-tight">
          {step === 0 ? "你的体重是多少?" : "每周饮食预算多少?"}
        </h1>
        <p className="mt-2 text-sm text-ink-600">
          {step === 0
            ? "用来算每日蛋白质目标(体重 × 1.6g)。可以跳过,跳过则按 100g/天。"
            : "包括外食和买菜。首页会显示本周还剩多少钱。"}
        </p>
      </div>

      {step === 0 ? (
        <div className="card space-y-4 p-5">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="70"
              className="input-base text-2xl"
            />
            <span className="text-ink-400">kg</span>
          </div>
          <p className="text-sm text-ink-600">
            每日蛋白质目标:<b className="text-ink-900">{target} g</b>
          </p>
          <button onClick={() => setStep(1)} className="btn-primary w-full py-3">
            {weight ? "下一步" : "跳过"}
          </button>
        </div>
      ) : (
        <div className="card space-y-4 p-5">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(CURRENCIES) as Currency[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCurrency(c)}
                aria-pressed={currency === c}
                className={`rounded-xl border px-3 py-2 text-sm ${
                  currency === c ? "border-brand-500 bg-brand-50 font-semibold text-brand-700" : "border-ink-200 bg-white text-ink-600"
                }`}
              >
                {CURRENCIES[c].symbol} {CURRENCIES[c].name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-ink-400">{CURRENCIES[currency].symbol}</span>
            <input
              autoFocus
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder={currency === "CNY" ? "500" : "120"}
              className="input-base text-2xl"
            />
            <span className="text-ink-400">/周</span>
          </div>
          <button onClick={finish} disabled={!budget || Number(budget) <= 0} className="btn-primary w-full py-3">
            开始记录
          </button>
          <button onClick={() => setStep(0)} className="w-full text-sm text-ink-400">
            返回
          </button>
        </div>
      )}
    </div>
  );
}
