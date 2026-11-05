import { currencyOf, type Currency } from "./money";
import { DEFAULT_PROTEIN_TARGET_G, PROTEIN_G_PER_KG, type Settings, type WheyPreset } from "./types";

export function proteinTargetFromWeight(weightKg?: number | null): number {
  if (!weightKg || weightKg <= 0) return DEFAULT_PROTEIN_TARGET_G;
  return Math.round(weightKg * PROTEIN_G_PER_KG);
}

/**
 * 预算按天填 (2026-11-05). Storage keeps the weekly figure (seven days), so the weekly
 * report, exports and old data are untouched; the forms show and take the per-day amount.
 */
export function dailyBudgetOf(s: Pick<Settings, "weekly_budget_usd">): number {
  return Math.round((s.weekly_budget_usd / 7) * 100) / 100;
}

/**
 * Weekly figure for a per-day amount. `prev` is the weekly figure already stored: saving an
 * unchanged day amount keeps it to the cent (¥500 a week shows as ¥71.43 a day and must not
 * come back as ¥500.01).
 */
export function weeklyFromDaily(daily: number, prev?: number | null): number {
  const w = Math.round(Math.max(0, Number(daily) || 0) * 7 * 100) / 100;
  return prev != null && Math.abs(w - prev) < 0.05 ? prev : w;
}

export function buildSettings(input: {
  weight_kg?: number | null;
  weekly_budget_usd: number;
  protein_target_g?: number | null;
  currency?: Currency | null;
  whey?: WheyPreset | null;
  starter_seeded?: boolean;
  demo?: boolean;
  created_at?: number;
}): Settings {
  const s: Settings = {
    protein_target_g:
      input.protein_target_g && input.protein_target_g > 0
        ? Math.round(input.protein_target_g)
        : proteinTargetFromWeight(input.weight_kg),
    weekly_budget_usd: Math.max(0, Number(input.weekly_budget_usd) || 0),
    created_at: input.created_at ?? Date.now(),
  };
  if (input.weight_kg && input.weight_kg > 0) s.weight_kg = input.weight_kg;
  s.currency = currencyOf(input.currency);
  if (input.starter_seeded) s.starter_seeded = true;
  if (input.demo) s.demo = true; // editing settings while in the example keeps the "清空示例" banner
  // The preset only exists once the label's protein-per-scoop is filled in.
  if (input.whey && input.whey.protein_g > 0) {
    s.whey = {
      name: input.whey.name.trim(),
      protein_g: input.whey.protein_g,
      kcal: Math.max(0, input.whey.kcal || 0),
      tub_price: Math.max(0, input.whey.tub_price || 0),
      tub_scoops: Math.max(0, input.whey.tub_scoops || 0),
    };
  }
  return s;
}
