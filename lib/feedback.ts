// 即时回报 (PRD 2026-11-04 记录成本方案 #3): what the user sees right after a save.
// Pure derivation over meals so it can be unit-tested; nothing here is persisted.
//
// Two sentences, both computed, neither generated:
//  1. "这顿 50 分/g,本周第 3 划算" — this meal's 分/g and where it sits in this week's ranking.
//  2. "还差 40 g,约等于 2 份「鸡蛋」,约 ¥3" — the gap to today's target, expressed as the
//     cheapest-per-gram item in the user's OWN recent history. No external food list,
//     no model call, so it stays inside the Non-goal (no diet advice).
import { centsPerGram, mid, proteinRange } from "./derive";
import { isSupplement } from "./supplement";
import { rankByCentsPerGram } from "./weekly";
import type { Meal, Settings } from "./types";

export interface RankInfo {
  name: string;
  cpg: number; // this meal's own 分/g
  rank: number; // 1 = cheapest protein this week
  total: number; // how many distinct priced meals are ranked this week
}

export interface Suggestion {
  name: string;
  merchant: string | null;
  portions: number; // how many of that item would cover the gap (capped)
  cost: number; // portions × average amount paid
  proteinMid: number; // protein per portion (midpoint)
  cpg: number;
}

export interface Feedback {
  saved: number;
  rank: RankInfo | null; // null when none of the saved meals has a price + protein
  unpriced: boolean; // true when the saved meal(s) carried no price
  supplement: boolean; // true when only supplements were saved: they have their own row, no food rank
  eatenMid: number;
  target: number;
  deficit: number; // target − eaten midpoint; positive = still missing
  suggestion: Suggestion | null; // null when no gap or no priced history
}

export const SUGGESTION_MAX_PORTIONS = 3;

function keyOf(m: Meal): string {
  return `${(m.merchant ?? "").toLowerCase().trim()}|${m.meal_name.toLowerCase().trim()}`;
}

/** Cheapest protein in the user's own history, per portion (averaged over repeats). */
export function cheapestInHistory(history: Meal[]): Suggestion | null {
  const rows = rankByCentsPerGram(history);
  if (rows.length === 0) return null;
  const r = rows[0];
  const proteinMid = r.proteinMid / r.times;
  if (proteinMid <= 0) return null;
  return { name: r.name, merchant: r.merchant, portions: 0, cost: 0, proteinMid, cpg: r.cpg };
}

export function buildFeedback(
  saved: Meal[],
  weekMeals: Meal[], // this week's meals, saved ones included
  todayMeals: Meal[], // today's meals, saved ones included
  history: Meal[], // recent meals (e.g. 30 days) the suggestion may draw from
  settings: Settings,
): Feedback {
  // Rank: the saved meal with a computable 分/g (the cheapest if several).
  // Supplements never enter the food ranking, and cheapestInHistory() never suggests them.
  const food = saved.filter((m) => !isSupplement(m));
  const priced = food
    .map((m) => ({ m, cpg: centsPerGram(m) }))
    .filter((x): x is { m: Meal; cpg: number } => x.cpg != null)
    .sort((a, b) => a.cpg - b.cpg);
  let rank: RankInfo | null = null;
  if (priced.length > 0) {
    const rows = rankByCentsPerGram(weekMeals);
    const idx = rows.findIndex((r) => `${(r.merchant ?? "").toLowerCase().trim()}|${r.name.toLowerCase().trim()}` === keyOf(priced[0].m));
    rank = { name: priced[0].m.meal_name, cpg: priced[0].cpg, rank: idx + 1, total: rows.length };
  }

  const eaten = proteinRange(todayMeals);
  const eatenMid = mid(eaten.low, eaten.high);
  const target = settings.protein_target_g;
  const deficit = target - eatenMid;

  let suggestion: Suggestion | null = null;
  if (deficit > 0) {
    const best = cheapestInHistory(history);
    if (best) {
      const portions = Math.min(SUGGESTION_MAX_PORTIONS, Math.max(1, Math.ceil(deficit / best.proteinMid)));
      const perPortionCost = (best.cpg * best.proteinMid) / 100;
      suggestion = { ...best, portions, cost: Math.round(perPortionCost * portions * 100) / 100 };
    }
  }

  return {
    saved: saved.length,
    rank,
    unpriced: priced.length === 0 && food.some((m) => m.kind === "meal"),
    supplement: food.length === 0 && saved.some(isSupplement),
    eatenMid,
    target,
    deficit,
    suggestion,
  };
}

/** Short toast form, used by the home-page one-tap repeat. */
export function feedbackLine(f: Feedback): string {
  const gap = f.deficit > 0 ? `还差 ${Math.round(f.deficit)} g` : "今天已到目标";
  const rank = f.rank ? ` · 本周第 ${f.rank.rank} 划算` : "";
  return `${gap}${rank}`;
}
