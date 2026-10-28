// Derived numbers over the meals table. Nothing here is persisted (PRD).
import { fmtMoney, type Currency } from "./money";
import type { Meal, Settings } from "./types";

export { fmtMoney, cpgUnit } from "./money";

export function mid(low: number, high: number): number {
  return (low + high) / 2;
}

export interface Range { low: number; high: number }

/** Sum of protein ranges over nutrition rows (grocery rows are skipped). */
export function proteinRange(meals: Meal[]): Range {
  return meals.reduce(
    (acc, m) =>
      m.kind === "meal"
        ? { low: acc.low + (m.protein_low_g ?? 0), high: acc.high + (m.protein_high_g ?? 0) }
        : acc,
    { low: 0, high: 0 },
  );
}

export function kcalRange(meals: Meal[]): Range {
  return meals.reduce(
    (acc, m) =>
      m.kind === "meal"
        ? { low: acc.low + (m.kcal_low ?? 0), high: acc.high + (m.kcal_high ?? 0) }
        : acc,
    { low: 0, high: 0 },
  );
}

/** Every row counts toward spend, grocery included. */
export function spend(meals: Meal[]): number {
  return meals.reduce((s, m) => s + (m.amount_usd ?? 0), 0);
}

/** PRD: deficit = target − midpoint of today's eaten range. Positive = still missing. */
export function proteinDeficit(todayMeals: Meal[], settings: Settings): number {
  const r = proteinRange(todayMeals);
  return settings.protein_target_g - mid(r.low, r.high);
}

/** 蛋白质单价: hundredths of the user's currency (¢ or 分) per gram of protein (midpoint). null when not computable. */
export function centsPerGram(m: Meal): number | null {
  if (m.kind !== "meal" || m.amount_usd == null || m.amount_usd <= 0) return null;
  const p = mid(m.protein_low_g ?? 0, m.protein_high_g ?? 0);
  if (p <= 0) return null;
  return (m.amount_usd * 100) / p;
}

/** Fixed, factual sentence (PRD F3). No recommendations, no judgement. */
export function adviceSentence(deficitG: number, budgetLeft: number, currency: Currency = "USD"): string {
  const protein =
    deficitG > 0
      ? `今天蛋白还差约 ${Math.round(deficitG)}g`
      : `今天蛋白已到目标(约多 ${Math.round(-deficitG)}g)`;
  const budget =
    budgetLeft >= 0 ? `预算还剩 ${fmtMoney(budgetLeft, currency)}` : `预算已超 ${fmtMoney(-budgetLeft, currency)}`;
  return `${protein},${budget}。`;
}
