// Weekly report: pure derivation over meals (no storage access) so it can be unit-tested.
import { addDays, dayKey, startOfWeek } from "./dates";
import { fmtMoney, mid, spend } from "./derive";
import { currencyOf } from "./money";
import { isSupplement } from "./supplement";
import type { Meal, Settings } from "./types";

export interface RankRow {
  name: string;
  merchant: string | null;
  cpg: number; // cents per gram protein, aggregated over repeats
  amount: number;
  proteinMid: number;
  times: number;
}

/** Supplements (蛋白粉) summed into one row that sits outside the food ranking. */
export interface SupplementRow {
  name: string; // the most-logged supplement's name
  times: number;
  amount: number; // spend on the priced records
  proteinMid: number; // protein from all supplement records, priced or not
  cpg: number | null; // over priced records only; null when none has a price
}

export interface DayCell {
  key: string;
  label: string; // 一 二 三 ...
  proteinMid: number | null; // null = no nutrition rows that day
  met: boolean;
}

export interface WeeklyReport {
  weekStart: Date;
  weekEnd: Date; // exclusive
  spend: number;
  budget: number;
  days: DayCell[];
  daysRecorded: number;
  daysMet: number;
  ranking: RankRow[]; // food only
  supplement: SupplementRow | null;
  avgCpg: number | null; // every priced gram of protein this week, supplements included
  delta: string;
}

const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

function dayCells(weekStart: Date, meals: Meal[], target: number): DayCell[] {
  const byDay = new Map<string, number>();
  const seen = new Set<string>();
  for (const m of meals) {
    if (m.kind !== "meal") continue;
    const k = dayKey(m.ts);
    seen.add(k);
    byDay.set(k, (byDay.get(k) ?? 0) + mid(m.protein_low_g ?? 0, m.protein_high_g ?? 0));
  }
  return DAY_LABELS.map((label, i) => {
    const key = dayKey(addDays(weekStart, i));
    const proteinMid = seen.has(key) ? (byDay.get(key) ?? 0) : null;
    return { key, label, proteinMid, met: proteinMid != null && proteinMid >= target };
  });
}

/** Food ranking by 分/g. Supplements are left out on purpose (see lib/supplement.ts). */
export function rankByCentsPerGram(meals: Meal[]): RankRow[] {
  const groups = new Map<string, RankRow>();
  for (const m of meals) {
    if (m.kind !== "meal" || isSupplement(m) || m.amount_usd == null || m.amount_usd <= 0) continue;
    const p = mid(m.protein_low_g ?? 0, m.protein_high_g ?? 0);
    if (p <= 0) continue;
    const key = `${(m.merchant ?? "").toLowerCase().trim()}|${m.meal_name.toLowerCase().trim()}`;
    const g = groups.get(key) ?? { name: m.meal_name, merchant: m.merchant, cpg: 0, amount: 0, proteinMid: 0, times: 0 };
    g.amount += m.amount_usd;
    g.proteinMid += p;
    g.times += 1;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, cpg: (g.amount * 100) / g.proteinMid }))
    .sort((a, b) => a.cpg - b.cpg);
}

export function supplementRow(meals: Meal[]): SupplementRow | null {
  const rows = meals.filter(isSupplement);
  if (rows.length === 0) return null;
  const names = new Map<string, number>();
  let amount = 0;
  let pricedProtein = 0;
  let proteinMid = 0;
  for (const m of rows) {
    const p = mid(m.protein_low_g ?? 0, m.protein_high_g ?? 0);
    proteinMid += p;
    names.set(m.meal_name, (names.get(m.meal_name) ?? 0) + 1);
    if (m.amount_usd != null && m.amount_usd > 0) {
      amount += m.amount_usd;
      pricedProtein += p;
    }
  }
  const name = [...names.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { name, times: rows.length, amount, proteinMid, cpg: pricedProtein > 0 ? (amount * 100) / pricedProtein : null };
}

export function buildWeeklyReport(
  weekMeals: Meal[],
  prevWeekMeals: Meal[],
  settings: Settings,
  ref: Date | number,
): WeeklyReport {
  const weekStart = startOfWeek(ref);
  const weekEnd = addDays(weekStart, 7);
  const days = dayCells(weekStart, weekMeals, settings.protein_target_g);
  const daysRecorded = days.filter((d) => d.proteinMid != null).length;
  const daysMet = days.filter((d) => d.met).length;
  const ranking = rankByCentsPerGram(weekMeals);
  const supplement = supplementRow(weekMeals);
  // The weekly average is about the wallet, so priced supplement grams count here even
  // though they are not ranked against food.
  const suppPricedProtein = supplement?.cpg != null ? (supplement.amount * 100) / supplement.cpg : 0;
  const totalAmount = ranking.reduce((a, r) => a + r.amount, 0) + (supplement?.cpg != null ? supplement.amount : 0);
  const totalProtein = ranking.reduce((a, r) => a + r.proteinMid, 0) + suppPricedProtein;
  const avgCpg = totalProtein > 0 ? (totalAmount * 100) / totalProtein : null;

  const thisSpend = spend(weekMeals);
  const prevSpend = spend(prevWeekMeals);
  const prevDays = dayCells(addDays(weekStart, -7), prevWeekMeals, settings.protein_target_g);
  const prevMet = prevDays.filter((d) => d.met).length;
  const prevRecorded = prevDays.filter((d) => d.proteinMid != null).length;

  let delta: string;
  if (prevWeekMeals.length === 0) {
    delta = "上周没有记录,从这周开始有对比。";
  } else {
    const diff = thisSpend - prevSpend;
    const spendPart =
      Math.abs(diff) < 0.005
        ? "花销和上周持平"
        : `比上周${diff > 0 ? "多" : "少"}花 ${fmtMoney(Math.abs(diff), currencyOf(settings.currency))}`;
    delta = `${spendPart},蛋白达标天数 ${prevMet}/${prevRecorded} → ${daysMet}/${daysRecorded}。`;
  }

  return {
    weekStart, weekEnd, spend: thisSpend, budget: settings.weekly_budget_usd,
    days, daysRecorded, daysMet, ranking, supplement, avgCpg, delta,
  };
}
