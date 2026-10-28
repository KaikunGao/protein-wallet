"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ConfidenceBadge, { confidenceBorder } from "@/components/ConfidenceBadge";
import Onboarding from "@/components/Onboarding";
import { deleteMeal, getSettings, listMealsByDay, listMealsByWeek, logEvent } from "@/lib/db";
import { adviceSentence, centsPerGram, cpgUnit, fmtMoney, proteinDeficit, proteinRange, spend } from "@/lib/derive";
import { currencyOf } from "@/lib/money";
import { fmtTime } from "@/lib/dates";
import type { Meal, Settings } from "@/lib/types";

export default function Home() {
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [today, setToday] = useState<Meal[]>([]);
  const [week, setWeek] = useState<Meal[]>([]);

  const load = useCallback(async () => {
    const [s, t, w] = await Promise.all([getSettings(), listMealsByDay(), listMealsByWeek()]);
    setSettings(s);
    setToday(t);
    setWeek(w);
  }, []);

  useEffect(() => {
    // IndexedDB reads are async; state is set after await, not synchronously in the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().then(() => logEvent("page_open", { page: "today" }));
  }, [load]);

  async function remove(m: Meal) {
    if (!window.confirm(`删除「${m.meal_name}」?`)) return;
    await deleteMeal(m.id);
    void logEvent("meal_deleted", { input_type: m.input_type });
    await load();
  }

  if (settings === undefined) return <p className="py-8 text-zinc-500">加载中…</p>;
  if (settings === null) return <Onboarding onDone={(s) => { setSettings(s); void load(); }} />;

  const eaten = proteinRange(today);
  const deficit = proteinDeficit(today, settings);
  const weekSpent = spend(week);
  const budgetLeft = settings.weekly_budget_usd - weekSpent;
  const cur = currencyOf(settings.currency);

  return (
    <div className="space-y-5 py-2">
      <h1 className="text-2xl font-bold">今日</h1>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white p-4 shadow-sm" data-testid="protein-card">
          <p className="text-xs text-zinc-500">蛋白质</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {deficit > 0 ? `还差 ${Math.round(deficit)}` : `已到 +${Math.round(-deficit)}`}
            <span className="ml-1 text-base font-normal text-zinc-500">g</span>
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            已吃 {Math.round(eaten.low)}–{Math.round(eaten.high)} g / 目标 {settings.protein_target_g} g
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm" data-testid="budget-card">
          <p className="text-xs text-zinc-500">本周预算</p>
          <p className={`mt-1 text-3xl font-bold tabular-nums ${budgetLeft < 0 ? "text-red-600" : ""}`}>
            {budgetLeft < 0 ? `-${fmtMoney(-budgetLeft, cur)}` : fmtMoney(budgetLeft, cur)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            已花 {fmtMoney(weekSpent, cur)} / 预算 {fmtMoney(settings.weekly_budget_usd, cur)}
          </p>
        </div>
      </div>

      <p className="text-sm text-zinc-700" data-testid="advice">
        {adviceSentence(deficit, budgetLeft, cur)}
      </p>

      <Link
        href="/log"
        className="block rounded-2xl bg-green-600 py-4 text-center text-lg font-semibold text-white shadow"
      >
        + 记一餐
      </Link>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-500">今天记录({today.length})</h2>
        {today.length === 0 && (
          <p className="rounded-2xl bg-white p-4 text-sm text-zinc-400">还没有记录。拍一张或写一句就行。</p>
        )}
        {[...today].reverse().map((m) => {
          const cpg = centsPerGram(m);
          return (
            <div
              key={m.id}
              className={`rounded-2xl bg-white p-3 ${m.kind === "grocery" ? "border-2 border-solid border-zinc-300" : confidenceBorder(m.confidence)}`}
              data-testid="meal-row"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{m.meal_name}</p>
                  <p className="text-xs text-zinc-500">
                    {fmtTime(m.ts)}
                    {m.merchant ? ` · ${m.merchant}` : ""}
                    {m.user_corrected ? " · 已修正" : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums">{m.amount_usd != null ? fmtMoney(m.amount_usd, cur) : "—"}</p>
                  <button onClick={() => remove(m)} className="text-xs text-zinc-400" aria-label={`删除 ${m.meal_name}`}>
                    删除
                  </button>
                </div>
              </div>
              {m.kind === "meal" ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="tabular-nums">
                    蛋白 {m.protein_low_g}–{m.protein_high_g} g
                  </span>
                  <span className="text-zinc-400">·</span>
                  <span className="tabular-nums text-zinc-600">{m.kcal_low}–{m.kcal_high} kcal</span>
                  {cpg != null && (
                    <>
                      <span className="text-zinc-400">·</span>
                      <span className="tabular-nums text-zinc-600">{cpg.toFixed(1)}{cpgUnit(cur)}</span>
                    </>
                  )}
                  <ConfidenceBadge confidence={m.confidence} source={m.source} />
                </div>
              ) : (
                <p className="mt-2 text-sm text-zinc-600">
                  买菜 · {m.ingredients?.length ?? 0} 种食材,只计入花销
                </p>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
