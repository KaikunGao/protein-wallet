// Shared domain types. Kept dependency-free so both the Next app and the
// eval script (plain Node) can import them.

export type Confidence = "high" | "medium" | "low";
export type Source = "official_table" | "visual_estimate" | "text_estimate";
export type InputType = "text" | "photo" | "receipt" | "grocery";
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
  ingredients?: string[]; // grocery only: archived shopping list
  photo_ref?: string; // reserved; v1 does not persist photos
}

export interface Settings {
  weight_kg?: number;
  protein_target_g: number;
  weekly_budget_usd: number;
  meal_swipe_usd?: number; // optional default price for dining-hall swipes
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
