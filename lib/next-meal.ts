// 下一顿 / 每日清单 (PRD F0-1, 2026-11-04): what fits today's money, ordered by 分/g.
// Candidates come from two places the user already owns: dishes they have logged, and
// dishes on menus they scanned once and kept (SavedMenu). So the list is there every day
// without a photo. Pure derivation: no model call, one transparent sort key, and the copy
// never says "should" (Non-goal boundary: sorting by a visible metric is allowed).
import { addDays, startOfDay, startOfWeek } from "./dates";
import { mid, proteinRange, spend } from "./derive";
import { rankMenu, type MenuItem, type SavedMenu } from "./menu-rank";
import { isSupplement } from "./supplement";
import type { Meal, Settings } from "./types";

export const NEXT_MEAL_MAX = 3; // rows shown before "展开"
export const NEXT_MEAL_MORE = 8; // rows kept in total

export interface NextOption {
  key: string;
  name: string;
  venue: string | null;
  menuId: string | null; // the saved menu this row belongs to (a menu row, or a record picked from one)
  meal: Meal | null; // from the user's records: the latest one, re-logged on tap
  dish: MenuItem | null; // from a saved menu and never logged: recorded from the menu numbers on tap
  times: number; // how often it was logged in the history window (0 = never eaten)
  amount: number; // average paid per time, or the menu price
  proteinMid: number; // average protein per time (midpoint)
  cpg: number;
  over: boolean; // true = costs more than today's spendable amount
}

export type NextMealState =
  | "ok" // gap left and at least one affordable dish
  | "met" // today's protein target is reached
  | "no_history" // nothing priced has been logged and no menu has been saved
  | "over_budget"; // candidates exist but nothing fits today's money; shown flagged

export interface NextMeal {
  state: NextMealState;
  deficit: number; // target − today's eaten midpoint
  spendable: number; // what is left to spend today, never negative
  options: NextOption[]; // up to NEXT_MEAL_MORE
  candidates: number; // how many dishes were considered
}

function keyOf(venue: string | null, name: string): string {
  return `${(venue ?? "").toLowerCase().replace(/\s+/g, "")}|${name.toLowerCase().replace(/\s+/g, "")}`;
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
    const k = keyOf(m.merchant, m.meal_name);
    const g = groups.get(k);
    if (!g) groups.set(k, { meal: m, times: 1, amount: m.amount_usd, protein: p });
    else {
      g.times += 1;
      g.amount += m.amount_usd;
      g.protein += p;
      if (m.ts > g.meal.ts) g.meal = m;
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      name: g.meal.meal_name,
      venue: g.meal.merchant,
      menuId: g.meal.menu_id ?? null,
      meal: g.meal,
      dish: null,
      times: g.times,
      amount: Math.round((g.amount / g.times) * 100) / 100,
      proteinMid: g.protein / g.times,
      cpg: (g.amount * 100) / g.protein,
      over: false,
    }))
    .sort(byCpg);
}

/** Rankable dishes from the saved menus (priced, real protein source), one row per place + dish. */
export function menuDishes(menus: SavedMenu[]): NextOption[] {
  const out = new Map<string, NextOption>();
  for (const menu of menus) {
    for (const d of rankMenu(menu.items).ranked) {
      const key = keyOf(menu.name, d.name);
      if (out.has(key)) continue;
      out.set(key, {
        key,
        name: d.name,
        venue: menu.name,
        menuId: menu.id,
        meal: null,
        dish: d,
        times: 0,
        amount: d.price ?? 0,
        proteinMid: d.proteinMid,
        cpg: d.cpg,
        over: false,
      });
    }
  }
  return [...out.values()].sort(byCpg);
}

function byCpg(a: NextOption, b: NextOption): number {
  return a.cpg - b.cpg || b.times - a.times || a.name.localeCompare(b.name);
}

/** History and saved menus together. A dish the user has logged at that place wins over the menu row: it carries their own corrections. */
export function candidates(history: Meal[], menus: SavedMenu[]): NextOption[] {
  const fromHistory = pricedDishes(history);
  // Two ways to recognise "already logged": same place name + dish, or (after the place was
  // renamed) the menu id stamped on the record + dish.
  const byMenu = (id: string, name: string) => `#${id}|${name.toLowerCase().replace(/\s+/g, "")}`;
  const seen = new Set<string>();
  for (const o of fromHistory) {
    seen.add(o.key);
    if (o.menuId) seen.add(byMenu(o.menuId, o.name));
  }
  const fresh = menuDishes(menus).filter((o) => !seen.has(o.key) && !(o.menuId && seen.has(byMenu(o.menuId, o.name))));
  return [...fromHistory, ...fresh].sort(byCpg);
}

export function buildNextMeal(
  history: Meal[], // recent meals (e.g. 30 days), today's included
  weekMeals: Meal[],
  todayMeals: Meal[],
  settings: Settings,
  now: number,
  menus: SavedMenu[] = [],
): NextMeal {
  const eaten = proteinRange(todayMeals);
  const deficit = settings.protein_target_g - mid(eaten.low, eaten.high);
  const spendable = spendableToday(weekMeals, settings, now);
  if (deficit <= 0) return { state: "met", deficit, spendable, options: [], candidates: 0 };

  const all = candidates(history, menus);
  if (all.length === 0) return { state: "no_history", deficit, spendable, options: [], candidates: 0 };

  const affordable = all.filter((d) => d.amount <= spendable);
  if (affordable.length > 0) {
    return { state: "ok", deficit, spendable, options: affordable.slice(0, NEXT_MEAL_MORE), candidates: all.length };
  }
  // Nothing fits today's money: still show the cheapest protein, flagged, so the card states a fact instead of going blank.
  return {
    state: "over_budget",
    deficit,
    spendable,
    options: all.slice(0, NEXT_MEAL_MAX).map((d) => ({ ...d, over: true })),
    candidates: all.length,
  };
}
