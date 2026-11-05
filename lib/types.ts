// Shared domain types. Kept dependency-free so both the Next app and the
// eval script (plain Node) can import them.
import type { SavedMenu } from "./menu-rank";
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
  | "text_estimate"
  | "ingredient_table" // 拍菜单: protein summed from data/ingredients.json (reference data, never 官方)
  | "label"; // 蛋白粉预设: numbers the user copied from the product label
// "repeat" = one-tap copy of a recent meal from the home page (no model call).
// "preset" = one-tap scoop of the user's own protein powder (settings.whey), no model call.
// "menu" = picked from a 拍菜单 ranking (the dish was estimated from a menu, before eating).
export type InputType = "text" | "photo" | "receipt" | "grocery" | "repeat" | "preset" | "menu";
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
  demo?: boolean; // part of the built-in example data; removed by "清空示例"
  menu_id?: string; // the saved menu this record was picked from; survives renaming the place
  supplement?: boolean; // 蛋白粉 etc.: own row in the weekly report, never in the food ranking
  ingredients?: string[]; // grocery only: archived shopping list
  photo_ref?: string; // reserved; v1 does not persist photos
}

// 蛋白粉一键预设 (PRD F1.5): typed once from the label and the receipt.
export interface WheyPreset {
  name: string; // brand / product, shown on the chip
  protein_g: number; // protein per scoop, from the label
  kcal: number; // kcal per scoop, from the label (0 = not given)
  tub_price: number; // what the tub cost, 元 (0 = not given)
  tub_scoops: number; // scoops per tub (0 = not given)
}

export interface Settings {
  weight_kg?: number;
  protein_target_g: number;
  weekly_budget_usd: number;
  currency?: Currency; // always CNY since 2026-11-04; kept so old exports still parse
  whey?: WheyPreset;
  demo?: boolean; // the app is showing the example data
  starter_seeded?: boolean; // the built-in starter list was added once; never re-add after the user deletes it
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
  | "feedback_shown" // 即时回报 card / toast rendered after a save
  | "demo_start" // the visitor chose the example data on the first screen
  | "demo_clear" // the example data was cleared
  | "menu_shared" // a share link was made for one or all saved places
  | "menu_imported" // places from a share link were saved on this device
  | "menu_ranked" // a menu (photo or text) was parsed and ranked by 分/g
  | "rank_picked" // a record created by tapping a row in a 分/g ranking (下一顿 card, later: menu scan)
  | "decision_changed" // weekly one-tap answer: did the numbers change where / what the user ate this week?
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
  menus?: SavedMenu[]; // saved places (since 2026-11-04); absent in older exports
}

export const DEFAULT_PROTEIN_TARGET_G = 100;
export const PROTEIN_G_PER_KG = 1.6;
