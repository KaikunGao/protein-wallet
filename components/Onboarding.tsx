"use client";

import { useState } from "react";
import { logEvent, saveSettings } from "@/lib/db";
import { CURRENCIES, DEFAULT_CURRENCY, fmtMoney } from "@/lib/money";
import { buildSettings, proteinTargetFromWeight, weeklyFromDaily } from "@/lib/settings";
import type { Settings } from "@/lib/types";

// First-launch flow: two questions, no account. Weight is optional.
export default function Onboarding({ onDone, onDemo }: { onDone: (s: Settings) => void; onDemo?: () => void }) {
  const [step, setStep] = useState<0 | 1>(0);
  const [weight, setWeight] = useState("");
  const [budget, setBudget] = useState(""); // per day; stored as seven of them

  const target = proteinTargetFromWeight(weight ? Number(weight) : null);

  async function finish() {
    const s = buildSettings({
      weight_kg: weight ? Number(weight) : null,
      weekly_budget_usd: weeklyFromDaily(Number(budget)),
      currency: DEFAULT_CURRENCY,
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
          {step === 0 ? "你的体重是多少?" : "每天吃饭的预算是多少?"}
        </h1>
        <p className="mt-2 text-sm text-ink-600">
          {step === 0
            ? "用来算每日蛋白质目标(体重 × 1.6g)。可以跳过,跳过则按 100g/天。"
            : "一天三餐加起来大概花多少。首页按这个数列出今天吃得起的;可以花超,花超了会提醒你。"}
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
          <div className="flex items-center gap-2">
            <span className="text-ink-400">{CURRENCIES[DEFAULT_CURRENCY].symbol}</span>
            <input
              autoFocus
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="40"
              className="input-base text-2xl"
              data-testid="budget-input"
            />
            <span className="text-ink-400">/天</span>
          </div>
          {Number(budget) > 0 && (
            <p className="text-sm text-ink-600" data-testid="budget-week-hint">
              一周约 <b className="text-ink-900">{fmtMoney(weeklyFromDaily(Number(budget)))}</b>
            </p>
          )}
          <button onClick={finish} disabled={!budget || Number(budget) <= 0} className="btn-primary w-full py-3">
            开始记录
          </button>
          <button onClick={() => setStep(0)} className="w-full text-sm text-ink-400">
            返回
          </button>
        </div>
      )}

      {/* 示例数据: a visitor (an interviewer, a curious classmate) can see a filled app in one tap. */}
      {onDemo && (
        <button onClick={onDemo} className="card flex w-full items-center gap-3 p-4 text-left active:scale-[0.99]" data-testid="demo-button">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink-900">不想填?先看示例</span>
            <span className="mt-0.5 block text-xs text-ink-400">13 张真实的外卖订单截图,解析之后的样子。随时可以清空,换成自己的。</span>
          </span>
          <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">看示例</span>
        </button>
      )}
    </div>
  );
}
