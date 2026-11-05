// 示例数据 (2026-11-04): one tap on the first screen fills the app with 13 real 外卖
// orders, so a visitor sees a working product instead of an empty one. The numbers in
// data/demo-orders.json came out of the app's own receipt parser; nothing was hand-edited.
// Demo records carry `demo: true` and can be cleared without touching real ones.
import demoData from "../data/demo-orders.json";
import { addDays, startOfDay } from "./dates";
import type { Confidence, Meal, Settings, Source } from "./types";

export const DEMO_ORDER_COUNT = demoData.orders.length;
const MINUTE = 60_000;

export function demoSettings(now: number): Settings {
  return { protein_target_g: 100, weekly_budget_usd: 500, currency: "CNY", created_at: now, demo: true };
}

/** The demo orders as meal records, laid out over the last 12 days ending today. */
export function demoMeals(now: number, newId: () => string): Meal[] {
  const out: Meal[] = [];
  for (const o of demoData.orders) {
    const [h, m] = o.time.split(":").map(Number);
    let ts = addDays(startOfDay(now), -o.days_ago).getTime() + h * 60 * MINUTE + m * MINUTE;
    if (ts > now) ts = now - 5 * MINUTE; // today's lunch seen in the morning: keep it in the past
    o.items.forEach((it, k) => {
      out.push({
        id: newId(),
        ts: ts + k, // keeps the dishes of one order in order
        kind: "meal",
        input_type: "receipt",
        meal_name: it.meal_name,
        merchant: o.shop,
        amount_usd: it.amount,
        kcal_low: it.kcal_low,
        kcal_high: it.kcal_high,
        protein_low_g: it.protein_low_g,
        protein_high_g: it.protein_high_g,
        confidence: it.confidence as Confidence,
        basis: it.basis,
        source: it.source as Source,
        user_corrected: false,
        portion_factor: 1,
        demo: true,
      });
    });
  }
  return out.sort((a, b) => a.ts - b.ts);
}
