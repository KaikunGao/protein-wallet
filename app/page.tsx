"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ConfidenceBadge from "@/components/ConfidenceBadge";
import MealEditor from "@/components/MealEditor";
import Onboarding from "@/components/Onboarding";
import { addMeal, deleteMeal, getSettings, listMealsByDay, listMealsByWeek, listMealsSince, logEvent, newId, updateMeal } from "@/lib/db";
import { adviceSentence, centsPerGram, cpgUnit, fmtMoney, mid, proteinDeficit, proteinRange, spend } from "@/lib/derive";
import { currencyOf } from "@/lib/money";
import { fmtTime } from "@/lib/dates";
import type { Meal, Settings } from "@/lib/types";

const RECENT_DAYS = 14;
const RECENT_MAX = 3;

/** Distinct recent meals (newest first) for one-tap repeat; grocery rows excluded. */
function recentDistinct(meals: Meal[], today: Meal[]): Meal[] {
  const todayKeys = new Set(today.map((m) => keyOf(m)));
  const seen = new Set<string>();
  const out: Meal[] = [];
  for (const m of [...meals].reverse()) {
    if (m.kind !== "meal") continue;
    const k = keyOf(m);
    if (seen.has(k) || todayKeys.has(k)) continue;
    seen.add(k);
    out.push(m);
    if (out.length >= RECENT_MAX) break;
  }
  return out;
}
/** New record with the same nutrition/amount as `m`, stamped now. Kept outside the component for the purity lint. */
function cloneForRepeat(m: Meal): Meal {
  return { ...m, id: newId(), ts: Date.now(), input_type: "repeat", user_corrected: false };
}
function keyOf(m: Meal) {
  return `${(m.merchant ?? "").toLowerCase().trim()}|${m.meal_name.toLowerCase().trim()}`;
}

export default function Home() {
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [today, setToday] = useState<Meal[]>([]);
  const [week, setWeek] = useState<Meal[]>([]);
  const [recent, setRecent] = useState<Meal[]>([]);
  const [editing, setEditing] = useState<Meal | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = Date.now() - RECENT_DAYS * 86400e3;
    const [s, t, w, r] = await Promise.all([getSettings(), listMealsByDay(), listMealsByWeek(), listMealsSince(since)]);
    setSettings(s);
    setToday(t);
    setWeek(w);
    setRecent(recentDistinct(r, t));
  }, []);

  useEffect(() => {
    // IndexedDB reads are async; state is set after await, not synchronously in the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().then(() => logEvent("page_open", { page: "today" }));
  }, [load]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1600);
  }

  async function repeat(m: Meal) {
    const copy = cloneForRepeat(m);
    await addMeal(copy);
    void logEvent("record_repeated", { source: m.source, merchant: m.merchant });
    void logEvent("record_saved", { input_type: "repeat", n: 1, corrected: false, duration_ms: 0 });
    flash(`已记一份「${m.meal_name}」`);
    await load();
  }

  async function saveEdit(m: Meal) {
    await updateMeal(m);
    void logEvent("meal_edited", { input_type: m.input_type, source: m.source });
    setEditing(null);
    flash("已修改");
    await load();
  }

  async function remove(m: Meal) {
    if (!window.confirm(`删除「${m.meal_name}」?`)) return;
    await deleteMeal(m.id);
    void logEvent("meal_deleted", { input_type: m.input_type });
    setEditing(null);
    await load();
  }

  if (settings === undefined) return <p className="py-8 text-ink-400">加载中…</p>;
  if (settings === null) return <Onboarding onDone={(s) => { setSettings(s); void load(); }} />;

  const cur = currencyOf(settings.currency);
  const eaten = proteinRange(today);
  const eatenMid = mid(eaten.low, eaten.high);
  const deficit = proteinDeficit(today, settings);
  const target = settings.protein_target_g;
  const pct = target > 0 ? Math.min(1, eatenMid / target) : 0;
  const weekSpent = spend(week);
  const budget = settings.weekly_budget_usd;
  const budgetLeft = budget - weekSpent;
  const budgetPct = budget > 0 ? Math.min(1, weekSpent / budget) : 0;

  const R = 44;
  const C = 2 * Math.PI * R;

  return (
    <div className="space-y-5 py-2">
      <header className="flex items-end justify-between">
        <div>
          <p className="label-xs">今日</p>
          <h1 className="text-2xl font-bold tracking-tight">{todayLabel()}</h1>
        </div>
        <p className="text-xs text-ink-400">蛋白钱包</p>
      </header>

      {/* Hero: protein ring + budget bar on one card */}
      <section className="card-hero p-5" data-testid="hero">
        <div className="flex items-center gap-5">
          <div className="relative h-28 w-28 shrink-0" data-testid="protein-card">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="9" />
              <circle
                cx="50" cy="50" r={R} fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
                style={{ transition: "stroke-dashoffset .6s ease" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold leading-none tabular-nums">{Math.round(eatenMid)}</span>
              <span className="mt-1 text-[10px] text-white/80">/ {target} g</span>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-white/75">蛋白质</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">
              {deficit > 0 ? `还差 ${Math.round(deficit)} g` : `已到目标 +${Math.round(-deficit)} g`}
            </p>
            <p className="mt-0.5 text-xs text-white/75">
              已吃 {Math.round(eaten.low)}–{Math.round(eaten.high)} g
            </p>
            <div className="mt-4" data-testid="budget-card">
              <div className="flex items-baseline justify-between text-xs text-white/75">
                <span>本周预算</span>
                <span className="tabular-nums">
                  {fmtMoney(weekSpent, cur)} / {fmtMoney(budget, cur)}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/25">
                <div className={`h-full rounded-full ${budgetLeft < 0 ? "bg-red-300" : "bg-white"}`} style={{ width: `${budgetPct * 100}%`, transition: "width .6s ease" }} />
              </div>
              <p className="mt-1 text-sm font-semibold tabular-nums">
                {budgetLeft < 0 ? `超出 ${fmtMoney(-budgetLeft, cur)}` : `还剩 ${fmtMoney(budgetLeft, cur)}`}
              </p>
            </div>
          </div>
        </div>
        <p className="mt-4 border-t border-white/15 pt-3 text-sm text-white/90" data-testid="advice">
          {adviceSentence(deficit, budgetLeft, cur)}
        </p>
      </section>

      <Link href="/log" className="btn-primary block py-4 text-center text-lg shadow-[0_10px_24px_-10px_rgb(21_128_61/0.7)]">
        + 记一餐
      </Link>

      {recent.length > 0 && (
        <section className="space-y-2" data-testid="repeat">
          <h2 className="label-xs">再来一份 · 最近吃过</h2>
          <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {recent.map((m) => (
              <button
                key={m.id}
                onClick={() => repeat(m)}
                className="card flex min-w-[46%] shrink-0 flex-col items-start gap-1 p-3 text-left active:scale-[0.98]"
              >
                <span className="line-clamp-1 text-sm font-semibold">{m.meal_name}</span>
                <span className="text-[11px] text-ink-400">
                  {m.merchant ? `${m.merchant} · ` : ""}蛋白 {m.protein_low_g}–{m.protein_high_g} g
                  {m.amount_usd != null ? ` · ${fmtMoney(m.amount_usd, cur)}` : ""}
                </span>
                <span className="mt-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">+ 再来一份</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="label-xs">今天记录({today.length})</h2>
        {today.length === 0 && (
          <p className="card p-4 text-sm text-ink-400">还没有记录。拍一张、说一句或写一句就行。</p>
        )}
        {[...today].reverse().map((m) => {
          const cpg = centsPerGram(m);
          return (
            <button
              key={m.id}
              onClick={() => setEditing(m)}
              className="card block w-full p-3 text-left active:scale-[0.99]"
              data-testid="meal-row"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{m.meal_name}</p>
                  <p className="text-xs text-ink-400">
                    {fmtTime(m.ts)}
                    {m.merchant ? ` · ${m.merchant}` : ""}
                    {m.user_corrected ? " · 已修正" : ""}
                    {m.input_type === "repeat" ? " · 再来一份" : ""}
                  </p>
                </div>
                <p className="shrink-0 font-semibold tabular-nums">{m.amount_usd != null ? fmtMoney(m.amount_usd, cur) : "—"}</p>
              </div>
              {m.kind === "meal" ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="tabular-nums">蛋白 {m.protein_low_g}–{m.protein_high_g} g</span>
                  <span className="text-ink-200">·</span>
                  <span className="tabular-nums text-ink-600">{m.kcal_low}–{m.kcal_high} kcal</span>
                  {cpg != null && (
                    <>
                      <span className="text-ink-200">·</span>
                      <span className="tabular-nums text-ink-600">{cpg.toFixed(1)}{cpgUnit(cur)}</span>
                    </>
                  )}
                  <ConfidenceBadge confidence={m.confidence} source={m.source} />
                </div>
              ) : (
                <p className="mt-2 text-sm text-ink-600">买菜 · {m.ingredients?.length ?? 0} 种食材,只计入花销</p>
              )}
            </button>
          );
        })}
      </section>

      {editing && (
        <MealEditor meal={editing} currency={cur} onSave={saveEdit} onDelete={remove} onClose={() => setEditing(null)} />
      )}
      {toast && (
        <p className="fixed inset-x-0 bottom-24 z-30 mx-auto w-fit rounded-full bg-ink-900 px-4 py-2 text-sm text-white shadow-lg rise" role="status">
          {toast}
        </p>
      )}
    </div>
  );
}

function todayLabel(): string {
  const d = new Date();
  const w = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${w}`;
}
