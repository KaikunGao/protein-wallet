// 下一顿卡片 (PRD F0-1, 2026-11-04): before the next meal, show what the user has already
// eaten that fits today's money, ordered by 分/g. Pure derivation over the user's own
// records: no model call, no outside food list, one transparent sort key. The copy never
// says "should" (Non-goal boundary: sorting by a visible metric is allowed, advice is not).
import { addDays, startOfDay, startOfWeek } from "./dates";
import { mid, proteinRange, spend } from "./derive";
import { isSupplement } from "./supplement";
import type { Meal, Settings } from "./types";

export const NEXT_MEAL_MAX = 3;

export interface NextOption {
  meal: Meal; // latest record of this dish, the one a tap re-logs
  times: number; // how often it was logged in the history window
  amount: number; // average paid per time
  proteinMid: number; // average protein per time (midpoint)
  cpg: number; // 分/g over all times
  over: boolean; // true = costs more than today's spendable amount
}

export type NextMealState =
  | "ok" // gap left and at least one affordable dish
  | "met" // today's protein target is reached
  | "no_history" // nothing priced has been logged yet
  | "over_budget"; // history exists but nothing fits today's money; options are shown flagged

export interface NextMeal {
  state: NextMealState;
  deficit: number; // target − today's eaten midpoint
  spendable: number; // what is left to spend today, never negative
  options: NextOption[];
}

function keyOf(m: Meal): string {
  return `${(m.merchant ?? "").toLowerCase().trim()}|${m.meal_name.toLowerCase().trim()}`;
}

/**
 * Today's spendable money = (weekly budget − spent before today) ÷ days left in the week
 * including today, minus what was already spent today. Unspent money from earlier days is
 * spread over the rest of the week instead of being lost.
 */
export function spendableToday(weekMeals: Meal[], settings: Settings, now: number): number {
  const dayStart = startOfDay(now).getTime();
  const weekEnd = addDays(startOfWeek(now), 7).getTime();
  const daysLeft = Math.max(1, Math.round((weekEnd - dayStart) / 86400e3));
  const before = spend(weekMeals.filter((m) => m.ts < dayStart));
  const today = spend(weekMeals.filter((m) => m.ts >= dayStart));
  const allowance = (settings.weekly_budget_usd - before) / daysLeft;
  return Math.max(0, Math.round((allowance - today) * 100) / 100);
}

/** Priced food the user has logged, one row per dish, cheapest protein first. Supplements and grocery rows are left out. */
export function pricedDishes(history: Meal[]): NextOption[] {
  const groups = new Map<string, { meal: Meal; times: number; amount: number; protein: number }>();
  for (const m of history) {
    if (m.kind !== "meal" || isSupplement(m) || m.amount_usd == null || m.amount_usd <= 0) continue;
    const p = mid(m.protein_low_g ?? 0, m.protein_high_g ?? 0);
    if (p <= 0) continue;
    const k = keyOf(m);
    const g = groups.get(k);
    if (!g) groups.set(k, { meal: m, times: 1, amount: m.amount_usd, protein: p });
    else {
      g.times += 1;
      g.amount += m.amount_usd;
      g.protein += p;
      if (m.ts > g.meal.ts) g.meal = m;
    }
  }
  return [...groups.values()]
    .map((g) => ({
      meal: g.meal,
      times: g.times,
      amount: Math.round((g.amount / g.times) * 100) / 100,
      proteinMid: g.protein / g.times,
      cpg: (g.amount * 100) / g.protein,
      over: false,
    }))
    .sort((a, b) => a.cpg - b.cpg || b.meal.ts - a.meal.ts);
}

export function buildNextMeal(
  history: Meal[], // recent meals (e.g. 30 days), today's included
  weekMeals: Meal[],
  todayMeals: Meal[],
  settings: Settings,
  now: number,
): NextMeal {
  const eaten = proteinRange(todayMeals);
  const deficit = settings.protein_target_g - mid(eaten.low, eaten.high);
  const spendable = spendableToday(weekMeals, settings, now);
  if (deficit <= 0) return { state: "met", deficit, spendable, options: [] };

  const dishes = pricedDishes(history);
  if (dishes.length === 0) return { state: "no_history", deficit, spendable, options: [] };

  const affordable = dishes.filter((d) => d.amount <= spendable);
  if (affordable.length > 0) {
    return { state: "ok", deficit, spendable, options: affordable.slice(0, NEXT_MEAL_MAX) };
  }
  // Nothing fits today's money: still show the cheapest protein, flagged, so the card states a fact instead of going blank.
  return {
    state: "over_budget",
    deficit,
    spendable,
    options: dishes.slice(0, NEXT_MEAL_MAX).map((d) => ({ ...d, over: true })),
  };
}
