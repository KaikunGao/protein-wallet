// Shared domain types. Kept dependency-free so both the Next app and the
// eval script (plain Node) can import them.
import type { Currency } from "./money";

export type Confidence = "high" | "medium" | "low";
// DECISION (2026-10-28): three data tiers above pure guessing.
//  official_table  chain rows checked line by line against the chain's own site
//  reference_table chain rows entered from memory / only spot-checked (never "官方")
//  dining_menu     campus dining-hall menu with official per-portion nutrition;
//                  the portion count is still the model's visual guess
export type Source =
  | "official_table"
  | "reference_table"
  | "dining_menu"
  | "visual_estimate"
  | "text_estimate";
// "repeat" = one-tap copy of a recent meal from the home page (no model call).
export type InputType = "text" | "photo" | "receipt" | "grocery" | "repeat";
// DECISION: grocery purchases live in the same `meals` table with kind="grocery"
// and null nutrition fields, instead of a fourth table. Weekly spend sums every
// row; protein sums skip grocery rows.
export type MealKind = "meal" | "grocery";

export interface Meal {
  id: string;
  ts: number; // epoch ms, local time of the record
  kind: MealKind;
  input_type: InputType;
  meal_name: string;
  merchant: string | null;
  amount_usd: number | null;
  kcal_low: number | null;
  kcal_high: number | null;
  protein_low_g: number | null;
  protein_high_g: number | null;
  confidence: Confidence | null;
  basis: string;
  source: Source | null;
  user_corrected: boolean;
  portion_factor?: number; // one-tap portion correction applied on the confirm card (1 = as estimated)
  ingredients?: string[]; // grocery only: archived shopping list
  photo_ref?: string; // reserved; v1 does not persist photos
}

export interface Settings {
  weight_kg?: number;
  protein_target_g: number;
  weekly_budget_usd: number;
  meal_swipe_usd?: number; // optional default price for dining-hall swipes
  dining_hall?: string; // slug of the hall the user usually eats at (data/dining/uchicago/halls.json)
  currency?: Currency; // absent = USD (records made before the setting existed)
  meal_plan?: { cost: number; swipes: number }; // semester meal plan; meal_swipe_usd = cost / swipes
  created_at: number;
}

export type EventName =
  | "page_open"
  | "record_start"
  | "record_parsed"
  | "record_failed"
  | "record_corrected"
  | "record_saved"
  | "record_cancelled"
  | "record_repeated"
  | "meal_edited"
  | "meal_deleted"
  | "export"
  | "import";

export interface AppEvent {
  id?: number;
  ts: number;
  name: EventName;
  data?: Record<string, unknown>;
}

export interface ExportBundle {
  version: 1;
  exported_at: string;
  settings: Settings | null;
  meals: Meal[];
  events: AppEvent[];
}

export const DEFAULT_PROTEIN_TARGET_G = 100;
export const PROTEIN_G_PER_KG = 1.6;
