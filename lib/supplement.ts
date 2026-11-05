// Supplements (蛋白粉) are a monthly bulk purchase, not a per-meal choice: their 分/g is the
// same every week, so they get their own row in the weekly report and never enter the food
// ranking or the 即时回报 suggestion (PRD F4 排行榜规则, 2026-11-04).
// Pure module: no storage access, importable from the tsx test scripts.
import type { Meal, WheyPreset } from "./types";

const SUPPLEMENT_RE = /蛋白粉|乳清|增肌粉|whey|protein powder/i;

/** True for preset scoops and for anything the user logged by name ("一勺蛋白粉" in a 日结 sentence). */
export function isSupplement(m: Meal): boolean {
  return m.kind === "meal" && (m.supplement === true || SUPPLEMENT_RE.test(m.meal_name));
}

/** Price of one scoop in 元 (2 decimals), or null when the tub price / scoop count is missing. */
export function scoopPrice(w: WheyPreset): number | null {
  if (!(w.tub_price > 0) || !(w.tub_scoops > 0)) return null;
  return Math.round((w.tub_price / w.tub_scoops) * 100) / 100;
}

/** 分/g of the preset, or null when it has no price. */
export function presetCpg(w: WheyPreset): number | null {
  const p = scoopPrice(w);
  return p != null && w.protein_g > 0 ? (p * 100) / w.protein_g : null;
}

export const LABEL_SPREAD = 0.1; // label values are exact per level scoop; ±10% covers how full the scoop is

function spread(n: number): [number, number] {
  let lo = Math.round(n * (1 - LABEL_SPREAD));
  let hi = Math.round(n * (1 + LABEL_SPREAD));
  if (lo === hi) hi = lo + 1; // never a point value
  if (lo < 0) lo = 0;
  return [lo, hi];
}

/** One scoop of the user's own powder as a meal record. Numbers come from the label the user typed in. */
export function presetMeal(w: WheyPreset, id: string, ts: number): Meal {
  const [pl, ph] = spread(w.protein_g);
  const [kl, kh] = spread(w.kcal > 0 ? w.kcal : w.protein_g * 5); // ~5 kcal per g protein for a typical whey scoop
  const price = scoopPrice(w);
  const name = w.name.trim() || "蛋白粉";
  return {
    id,
    ts,
    kind: "meal",
    input_type: "preset",
    meal_name: `${name} 1 勺`,
    merchant: null,
    amount_usd: price,
    kcal_low: kl,
    kcal_high: kh,
    protein_low_g: pl,
    protein_high_g: ph,
    confidence: "high",
    basis:
      price != null
        ? `标签数据:每勺 ${w.protein_g} g 蛋白;整桶 ¥${w.tub_price} / ${w.tub_scoops} 勺`
        : `标签数据:每勺 ${w.protein_g} g 蛋白(没填价格)`,
    source: "label",
    user_corrected: false,
    portion_factor: 1,
    supplement: true,
  };
}
