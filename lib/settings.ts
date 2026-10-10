import { DEFAULT_PROTEIN_TARGET_G, PROTEIN_G_PER_KG, type Settings } from "./types";

export function proteinTargetFromWeight(weightKg?: number | null): number {
  if (!weightKg || weightKg <= 0) return DEFAULT_PROTEIN_TARGET_G;
  return Math.round(weightKg * PROTEIN_G_PER_KG);
}

export function buildSettings(input: {
  weight_kg?: number | null;
  weekly_budget_usd: number;
  protein_target_g?: number | null;
  meal_swipe_usd?: number | null;
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
  if (input.meal_swipe_usd && input.meal_swipe_usd > 0) s.meal_swipe_usd = input.meal_swipe_usd;
  return s;
}
