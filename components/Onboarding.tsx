"use client";

import { useState } from "react";
import { logEvent, saveSettings } from "@/lib/db";
import { buildSettings, proteinTargetFromWeight } from "@/lib/settings";
import type { Settings } from "@/lib/types";

// First-launch flow: two questions, no account. Weight is optional.
export default function Onboarding({ onDone }: { onDone: (s: Settings) => void }) {
  const [step, setStep] = useState<0 | 1>(0);
  const [weight, setWeight] = useState("");
  const [budget, setBudget] = useState("");

  const target = proteinTargetFromWeight(weight ? Number(weight) : null);

  async function finish() {
    const s = buildSettings({
      weight_kg: weight ? Number(weight) : null,
      weekly_budget_usd: Number(budget),
    });
    await saveSettings(s);
    void logEvent("page_open", { page: "onboarding_done", weight_given: !!weight });
    onDone(s);
  }

  return (
    <div className="flex min-h-[70dvh] flex-col justify-center gap-6 py-6">
      <div>
        <p className="text-sm font-medium text-green-700">蛋白钱包</p>
        <h1 className="mt-1 text-2xl font-bold">
          {step === 0 ? "你的体重是多少?" : "每周饮食预算多少?"}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          {step === 0
            ? "用来算每日蛋白质目标(体重 × 1.6g)。可以跳过,跳过则按 100g/天。"
            : "包括外食和买菜。首页会显示本周还剩多少钱。"}
        </p>
      </div>

      {step === 0 ? (
        <>
          <div className="flex items-center gap-2">
            <input
              autoFocus
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="70"
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-2xl outline-none focus:border-green-600"
            />
            <span className="text-zinc-500">kg</span>
          </div>
          <p className="text-sm text-zinc-600">
            每日蛋白质目标:<b>{target} g</b>
          </p>
          <button
            onClick={() => setStep(1)}
            className="rounded-xl bg-green-600 py-3 font-semibold text-white"
          >
            {weight ? "下一步" : "跳过"}
          </button>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">$</span>
            <input
              autoFocus
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="120"
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-2xl outline-none focus:border-green-600"
            />
            <span className="text-zinc-500">/周</span>
          </div>
          <button
            onClick={finish}
            disabled={!budget || Number(budget) <= 0}
            className="rounded-xl bg-green-600 py-3 font-semibold text-white disabled:opacity-40"
          >
            开始记录
          </button>
          <button onClick={() => setStep(0)} className="text-sm text-zinc-500">
            返回
          </button>
        </>
      )}
    </div>
  );
}
