import { currencyOf, type Currency } from "./money";
import { DEFAULT_PROTEIN_TARGET_G, PROTEIN_G_PER_KG, type Settings, type WheyPreset } from "./types";

export function proteinTargetFromWeight(weightKg?: number | null): number {
  if (!weightKg || weightKg <= 0) return DEFAULT_PROTEIN_TARGET_G;
  return Math.round(weightKg * PROTEIN_G_PER_KG);
}

export function buildSettings(input: {
  weight_kg?: number | null;
  weekly_budget_usd: number;
  protein_target_g?: number | null;
  currency?: Currency | null;
  whey?: WheyPreset | null;
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
